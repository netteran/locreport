import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, unauthorized, requireResearchSchema } from '@/lib/adminAuth'
import { createServiceClient } from '@/lib/supabase/server'
import { checked } from '@/lib/research'
import { normalizeTopicInput, topicReadiness } from '@/lib/editorialTopics'
import {
  matchTopic, topicMatchesWithSources, topicsMigrationMessage, topicsMigrationMissing, writeProbes
} from '@/lib/topicMatching'

export const maxDuration = 300

/** Topics with their matches and readiness. `?summary=1` returns only the badge count. */
export async function GET(req: NextRequest) {
  if (!(await requireAdmin())) return unauthorized()
  try {
    const service = createServiceClient()
    if (req.nextUrl.searchParams.get('summary')) {
      const result = await service.from('editorial_topics').select('id', { count: 'exact', head: true }).eq('status', 'ready')
      if (topicsMigrationMissing(result.error)) return NextResponse.json({ ready: 0 })
      checked(result)
      return NextResponse.json({ ready: result.count ?? 0 })
    }
    const result = await service.from('editorial_topics')
      .select('id,title,brief,required_terms,status,notify_email,ready_at,notified_at,last_matched_at,composition_id,created_at')
      .order('created_at', { ascending: false }).limit(50)
    if (topicsMigrationMissing(result.error)) return NextResponse.json({ topics: [], migration: topicsMigrationMessage })
    const topics = checked(result) || []
    const matches = await topicMatchesWithSources(service, topics.map(t => t.id))
    return NextResponse.json({
      topics: topics.map(topic => {
        const own = matches.filter(m => m.topic_id === topic.id)
        return {
          ...topic,
          readiness: topicReadiness(own),
          // Irrelevant judgements stay stored so they are not paid for again, but are not shown.
          matches: own.filter(m => m.relevance > 0 || m.decision !== 'suggested')
            .sort((a, b) => b.relevance - a.relevance || b.similarity - a.similarity)
        }
      })
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

/** Create a topic, describe the evidence it needs, and match it against the existing pool. */
export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) return unauthorized()
  const service = createServiceClient()
  const schemaResponse = await requireResearchSchema(service)
  if (schemaResponse) return schemaResponse
  const input = normalizeTopicInput(await req.json().catch(() => null))
  if ('error' in input) return NextResponse.json({ error: input.error }, { status: 400 })
  const inserted = await service.from('editorial_topics').insert(input.topic).select('id,title,brief').single()
  if (topicsMigrationMissing(inserted.error)) return NextResponse.json({ error: topicsMigrationMessage }, { status: 503 })
  let topic: { id: string; title: string; brief: string }
  try {
    const row = checked(inserted)
    if (!row) throw new Error('Topic insert returned no row')
    topic = row
    await writeProbes(service, topic)
  } catch (e) {
    // A topic without evidence descriptions could never match anything; do not leave it behind.
    if (inserted.data?.id) await service.from('editorial_topics').delete().eq('id', inserted.data.id)
    return NextResponse.json({ error: String(e) }, { status: 502 })
  }
  try {
    const result = await matchTopic(service, topic.id)
    return NextResponse.json({ id: topic.id, ...result }, { status: 201 })
  } catch (e) {
    // The topic is saved; scheduled runs and "Find more sources" will continue matching.
    return NextResponse.json({ id: topic.id, warning: `Saved, but the first search failed: ${String(e)}` }, { status: 201 })
  }
}
