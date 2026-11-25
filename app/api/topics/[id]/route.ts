import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, unauthorized } from '@/lib/adminAuth'
import { createServiceClient } from '@/lib/supabase/server'
import { checked } from '@/lib/research'
import { normalizeTopicInput } from '@/lib/editorialTopics'
import { matchTopic, refreshTopicStatus, writeProbes } from '@/lib/topicMatching'

export const maxDuration = 300
type Params = { params: Promise<{ id: string }> }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Actions: `update` (title/brief/terms/notify), `status` (watching/paused/closed), `decision`
 * (accept/reject/reset a match), `match` (find more sources now), `composition` (link the composition
 * started from this topic).
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  if (!(await requireAdmin())) return unauthorized()
  try {
    const { id } = await params
    if (!UUID.test(id)) return NextResponse.json({ error: 'Unknown topic' }, { status: 404 })
    const body = await req.json().catch(() => ({}))
    const service = createServiceClient()
    const now = new Date().toISOString()
    const topic = checked(await service.from('editorial_topics')
      .select('id,title,brief,required_terms,status,brief_version').eq('id', id).maybeSingle())
    if (!topic) return NextResponse.json({ error: 'Unknown topic' }, { status: 404 })

    if (body.action === 'update') {
      const input = normalizeTopicInput(body)
      if ('error' in input) return NextResponse.json({ error: input.error }, { status: 400 })
      const changed = input.topic.title !== topic.title || input.topic.brief !== topic.brief ||
        JSON.stringify(input.topic.required_terms) !== JSON.stringify(topic.required_terms)
      if (!changed) {
        checked(await service.from('editorial_topics').update({ notify_email: input.topic.notify_email, updated_at: now }).eq('id', id))
        return NextResponse.json({ ok: true })
      }
      // A new brief is a new question: unreviewed judgements are redone, the editor's own
      // accept/reject decisions are kept, and the ready email may be sent again.
      await writeProbes(service, { id, title: input.topic.title, brief: input.topic.brief })
      checked(await service.from('editorial_topics').update({
        ...input.topic, brief_version: topic.brief_version + 1, ready_at: null, notified_at: null,
        status: topic.status === 'ready' ? 'watching' : topic.status, updated_at: now
      }).eq('id', id))
      checked(await service.from('topic_matches').delete().eq('topic_id', id).eq('decision', 'suggested'))
      return NextResponse.json(await matchTopic(service, id))
    }
    if (body.action === 'status') {
      if (!['watching', 'paused', 'closed'].includes(body.status))
        return NextResponse.json({ error: 'Status must be watching, paused or closed' }, { status: 400 })
      checked(await service.from('editorial_topics').update({ status: body.status, updated_at: now }).eq('id', id))
      return NextResponse.json(await refreshTopicStatus(service, id))
    }
    if (body.action === 'decision') {
      if (!['suggested', 'accepted', 'rejected'].includes(body.decision) || typeof body.candidate_id !== 'string')
        return NextResponse.json({ error: 'Invalid decision' }, { status: 400 })
      const updated = checked(await service.from('topic_matches').update({ decision: body.decision, updated_at: now })
        .eq('topic_id', id).eq('candidate_id', body.candidate_id).select('candidate_id'))
      if (!updated?.length) return NextResponse.json({ error: 'That source is not matched to this topic' }, { status: 404 })
      return NextResponse.json(await refreshTopicStatus(service, id))
    }
    if (body.action === 'match') return NextResponse.json(await matchTopic(service, id))
    if (body.action === 'composition') {
      if (typeof body.composition_id !== 'string' || !UUID.test(body.composition_id))
        return NextResponse.json({ error: 'Invalid composition' }, { status: 400 })
      checked(await service.from('editorial_topics').update({ composition_id: body.composition_id, updated_at: now }).eq('id', id))
      return NextResponse.json({ ok: true })
    }
    return NextResponse.json({ error: 'Invalid topic action' }, { status: 400 })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  if (!(await requireAdmin())) return unauthorized()
  try {
    const { id } = await params
    if (!UUID.test(id)) return NextResponse.json({ error: 'Unknown topic' }, { status: 404 })
    checked(await createServiceClient().from('editorial_topics').delete().eq('id', id))
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
