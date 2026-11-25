import { checked, jsonModel, type ResearchService } from '@/lib/research'
import { embedTexts } from '@/lib/embeddings'
import { publisherName } from '@/lib/candidateFilters'
import { getResend, fromWithName, SITE_URL } from '@/lib/email/send'
import { escapeXml } from '@/lib/utils'
import {
  JUDGE_PROMPT, PROBE_PROMPT, PROBE_SCHEMA, TOPIC_BATCH_SIZE, TOPIC_MIN_SIMILARITY,
  judgeSchema, nextTopicStatus, normalizeJudgements, normalizeProbes, topicReadiness,
  type ReadinessMatch, type TopicStatus
} from '@/lib/editorialTopics'

export const TOPICS_MIGRATION = '20261201_editorial_topics.sql'

/** The topics tables or functions are absent: the migration has not been applied yet. */
export function topicsMigrationMissing(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false
  return ['42P01', 'PGRST205', '42883', 'PGRST202'].includes(error.code || '') &&
    /editorial_topic|topic_matches|topic_shortlist/i.test(error.message || '')
}
export const topicsMigrationMessage = `Apply Supabase migration ${TOPICS_MIGRATION} to use My topics.`

type TopicRow = {
  id: string; title: string; brief: string; status: TopicStatus; notify_email: boolean
  brief_version: number; ready_at: string | null; notified_at: string | null
}
const TOPIC_COLUMNS = 'id,title,brief,status,notify_email,brief_version,ready_at,notified_at'

/** Describe the evidence the topic needs and store one embedding per description. */
export async function writeProbes(service: ResearchService, topic: Pick<TopicRow, 'id' | 'title' | 'brief'>) {
  const descriptions = normalizeProbes(await jsonModel(PROBE_PROMPT, { topic: { title: topic.title, brief: topic.brief } }, PROBE_SCHEMA, 0.3))
  if (descriptions.length < 3) throw new Error('Could not describe the evidence this topic needs; try rewording the brief.')
  const embeddings = await embedTexts(descriptions.map(d => `${topic.title}\n${d}`))
  checked(await service.from('editorial_topic_probes').delete().eq('topic_id', topic.id))
  checked(await service.from('editorial_topic_probes').insert(descriptions.map((description, position) => ({
    topic_id: topic.id, position, description, embedding: embeddings[position]
  }))))
}

/** Judge the next shortlist of unjudged candidates for one topic. Returns how many were judged. */
export async function matchTopicBatch(service: ResearchService, topic: TopicRow): Promise<number> {
  const shortlist = (checked(await service.rpc('topic_shortlist', {
    p_topic: topic.id, p_min_similarity: TOPIC_MIN_SIMILARITY, p_limit: TOPIC_BATCH_SIZE
  })) || []) as { candidate_id: string; similarity: number }[]
  checked(await service.from('editorial_topics').update({ last_matched_at: new Date().toISOString() }).eq('id', topic.id))
  if (!shortlist.length) return 0
  const ids = shortlist.map(row => row.candidate_id)
  const sources = (checked(await service.from('source_candidates')
    .select('id,title,source_name,source_published_at,extracted_facts').in('id', ids)) || []) as {
    id: string; title: string; source_name: string | null; source_published_at: string | null; extracted_facts: string
  }[]
  const judgedIds = ids.filter(id => sources.some(source => source.id === id))
  if (!judgedIds.length) return 0
  const response = await jsonModel(JUDGE_PROMPT, {
    today: new Date().toISOString().slice(0, 10),
    topic: { title: topic.title, brief: topic.brief },
    sources: judgedIds.map(id => {
      const source = sources.find(s => s.id === id)!
      return {
        candidate_id: id, title: source.title, publisher: publisherName(source),
        published: source.source_published_at?.slice(0, 10) ?? null,
        evidence: source.extracted_facts.slice(0, 2000)
      }
    })
  }, judgeSchema(judgedIds))
  const judgements = normalizeJudgements(response, judgedIds)
  checked(await service.from('topic_matches').upsert(judgements.map(j => ({
    topic_id: topic.id, candidate_id: j.candidate_id,
    similarity: shortlist.find(row => row.candidate_id === j.candidate_id)?.similarity ?? 0,
    relevance: j.relevance, role: j.role, contribution: j.contribution, judged_version: topic.brief_version
  })), { onConflict: 'topic_id,candidate_id', ignoreDuplicates: true }))
  return judgedIds.length
}

/** Load a topic's matches with the candidate details readiness depends on. */
export async function topicMatchesWithSources(service: ResearchService, topicIds: string[]) {
  if (!topicIds.length) return []
  const matches = (checked(await service.from('topic_matches')
    .select('topic_id,candidate_id,similarity,relevance,role,contribution,decision,created_at')
    .in('topic_id', topicIds)) || []) as (Omit<ReadinessMatch, 'event_id' | 'publisher'> & {
    topic_id: string; similarity: number; contribution: string; created_at: string
  })[]
  const candidateIds = [...new Set(matches.map(m => m.candidate_id))]
  const candidates: {
    id: string; title: string; source_url: string; source_name: string | null
    source_published_at: string | null; status: string; event_id: string | null; reserved_by: string | null
  }[] = []
  for (let offset = 0; offset < candidateIds.length; offset += 100) {
    candidates.push(...(checked(await service.from('source_candidates')
      .select('id,title,source_url,source_name,source_published_at,status,event_id,reserved_by')
      .in('id', candidateIds.slice(offset, offset + 100))) || []))
  }
  const byId = new Map(candidates.map(c => [c.id, c]))
  return matches.flatMap(match => {
    const source = byId.get(match.candidate_id)
    return source ? [{ ...match, event_id: source.event_id, publisher: publisherName(source), source }] : []
  })
}

/** Recompute readiness, move between watching/ready, and send the optional one-time email. */
export async function refreshTopicStatus(service: ResearchService, topicId: string) {
  const topic = checked(await service.from('editorial_topics').select(TOPIC_COLUMNS).eq('id', topicId).single()) as TopicRow
  const readiness = topicReadiness(await topicMatchesWithSources(service, [topicId]))
  const status = nextTopicStatus(topic.status, readiness.ready)
  const update: Record<string, unknown> = {}
  if (status !== topic.status) update.status = status
  if (status === 'ready' && !topic.ready_at) update.ready_at = new Date().toISOString()
  if (status === 'watching' && topic.ready_at) update.ready_at = null
  if (status === 'ready' && topic.notify_email && !topic.notified_at && await sendTopicReadyEmail(topic, readiness)) {
    update.notified_at = new Date().toISOString()
  }
  if (Object.keys(update).length) {
    checked(await service.from('editorial_topics').update({ ...update, updated_at: new Date().toISOString() }).eq('id', topicId))
  }
  return { status, readiness }
}

/** Judge up to `maxBatches` shortlists for one topic, then refresh its status. */
export async function matchTopic(service: ResearchService, topicId: string, maxBatches = 4) {
  const topic = checked(await service.from('editorial_topics').select(TOPIC_COLUMNS).eq('id', topicId).single()) as TopicRow
  let judged = 0
  for (let batch = 0; batch < maxBatches; batch++) {
    const count = await matchTopicBatch(service, topic)
    judged += count
    if (count < TOPIC_BATCH_SIZE) break
  }
  const { status, readiness } = await refreshTopicStatus(service, topicId)
  return { judged, status, readiness }
}

/**
 * One batch per open topic: what each scheduled research run calls after new candidates are
 * processed. Stops starting new topics after `budgetMs` so the call stays inside the function limit;
 * the workflow calls again, and topics with nothing new return without a model call.
 */
export async function matchOpenTopics(service: ResearchService, budgetMs = 200_000) {
  const started = Date.now()
  const result = await service.from('editorial_topics').select(TOPIC_COLUMNS).in('status', ['watching', 'ready'])
    .order('last_matched_at', { ascending: true, nullsFirst: true })
  if (topicsMigrationMissing(result.error)) return { judged: 0, topics: 0, errors: [], skipped: topicsMigrationMessage }
  const topics = (checked(result) || []) as TopicRow[]
  let judged = 0
  const errors: string[] = []
  for (const topic of topics) {
    if (Date.now() - started > budgetMs) break
    try {
      judged += await matchTopicBatch(service, topic)
      await refreshTopicStatus(service, topic.id)
    } catch (e) {
      errors.push(`${topic.title}: ${String(e)}`)
    }
  }
  return { judged, topics: topics.length, errors }
}

/** Email the admin once when a topic first gathers enough evidence. Never throws. */
async function sendTopicReadyEmail(topic: TopicRow, readiness: ReturnType<typeof topicReadiness>): Promise<boolean> {
  const to = process.env.ADMIN_EMAIL
  if (!to || !process.env.RESEND_API_KEY) return false
  try {
    const link = `${SITE_URL}/admin/candidates?tab=topics`
    const gaps = readiness.gaps.length
      ? `<p style="margin:0 0 12px">Still thin:</p><ul style="margin:0 0 16px;padding-left:20px">${readiness.gaps.map(g => `<li>${escapeXml(g)}</li>`).join('')}</ul>`
      : ''
    const { error } = await getResend().emails.send({
      from: fromWithName('LocReport Topics'),
      to,
      subject: `Ready to write: ${topic.title}`,
      html: `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#17181C;max-width:560px">
<p style="margin:0 0 12px">Your topic <strong>${escapeXml(topic.title)}</strong> has gathered enough evidence to start an article:
${readiness.independent} independent sources from ${readiness.publishers} publishers.</p>
${gaps}<p style="margin:0"><a href="${link}" style="color:#2C3CB8">Review the sources and start a composition →</a></p></div>`
    })
    if (error) { console.error('[topics] ready email failed', error); return false }
    return true
  } catch (e) {
    console.error('[topics] ready email failed', e)
    return false
  }
}
