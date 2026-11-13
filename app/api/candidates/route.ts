import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, unauthorized } from '@/lib/adminAuth'
import { createServiceClient } from '@/lib/supabase/server'
import { checked, descriptorForReview } from '@/lib/research'
import { eventIdentity } from '@/lib/eventMatching'
import { revalidateFactSurfaces } from '@/lib/revalidate'

export async function GET() {
  if (!(await requireAdmin())) return unauthorized()
  try {
    const service = createServiceClient()
    const [candidates, groups, events, compositions] = await Promise.all([
      service
        .from('source_candidates')
        .select(
          'id,title,source_url,source_name,source_feed_id,source_published_at,extracted_facts,quality,topics,entities,status,processing_status,review_reason,event_id,suggested_event_id,reserved_by,created_at'
        )
        .order('created_at', { ascending: false })
        .limit(300),
      service
        .from('story_groups')
        .select('*')
        .eq('dismissed', false)
        .order('created_at', { ascending: false })
        .limit(50),
      service
        .from('industry_events')
        .select('id,headline,stage,review_required')
        .order('created_at', { ascending: false })
        .limit(300),
      service
        .from('compositions')
        .select('id,title,status,draft_id,last_error')
        .neq('status', 'abandoned')
        .order('created_at', { ascending: false })
        .limit(100)
    ])
    return NextResponse.json({
      candidates: checked(candidates),
      groups: checked(groups),
      events: checked(events),
      compositions: checked(compositions)
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  if (!(await requireAdmin())) return unauthorized()
  try {
    const b = await req.json()
    const service = createServiceClient()
    if (b.group_id) {
      checked(await service.from('story_groups').update({ dismissed: true }).eq('id', b.group_id))
    } else if (b.merge_from && b.merge_into) {
      checked(
        await service.rpc('merge_industry_events', { p_from: b.merge_from, p_into: b.merge_into })
      )
      revalidateFactSurfaces()
    } else if (b.id && (b.event_id || b.new_event === true)) {
      const candidate = checked(
        await service.from('source_candidates').select('*').eq('id', b.id).single()
      )
      const event = await descriptorForReview(candidate)
      if (!event.newsworthy || !event.headline)
        throw new Error('This source has no qualifying current news event')
      // Manual matching attaches evidence; publication remains an explicit separate action.
      checked(
        await service.rpc('record_candidate_event', {
          p_candidate: b.id,
          p_event: b.new_event ? null : b.event_id,
          p_identity:
            eventIdentity(event, candidate.source_published_at) +
            (b.new_event ? `:reviewed:${candidate.id}` : ''),
          p_descriptor: event,
          p_relation: b.new_event ? 'new' : 'same',
          p_auto_eligible: false
        })
      )
      revalidateFactSurfaces()
    } else if (b.id && ['available', 'dismissed'].includes(b.status)) {
      const result = checked(
        await service
          .from('source_candidates')
          .update({ status: b.status })
          .eq('id', b.id)
          .in('status', ['available', 'dismissed', 'used'])
          .select('id')
      )
      if (!result?.length)
        return NextResponse.json(
          { error: 'Reserved or used sources cannot be dismissed' },
          { status: 409 }
        )
    } else return NextResponse.json({ error: 'Invalid candidate action' }, { status: 400 })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 })
  }
}
