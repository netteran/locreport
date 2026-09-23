import type { createServiceClient } from '@/lib/supabase/server'
import { slugify, uniqueSlug } from '@/lib/slugify'
import { extractTeaser } from '@/lib/utils'
import { getDirectoryEntries, linkifyCompanyMentions } from '@/lib/companyLinks'
import { approveDraft } from '@/lib/publish'
import {
  extractPodcastNotes,
  isBeforeBaseline,
  isYouTubeUrl,
  listEpisodes,
  parsePodcastConfig,
  writePodcastArticle,
  WRITING_PLACEHOLDER,
  type EpisodeMedia,
  type PodcastConfig,
  type PodcastEpisode,
} from '@/lib/podcast'

type Service = ReturnType<typeof createServiceClient>
type SourceRow = { id: string; name: string; url: string; active: boolean; kind?: string; auto_publish?: boolean; podcast_config: unknown }
type DraftRow = { id: string; title: string; source_url: string | null; source_feed_id: string | null; extracted_facts: string | null; content: string }

/**
 * The two podcast steps, shared by the manual admin buttons
 * (/api/podcasts/[id]/ingest + /write) and the automatic runner
 * (/api/podcasts/auto). Each step is one Gemini call sized to fit a 300 s
 * Vercel function, so every caller runs them in separate requests.
 */

export function loadConfig(source: SourceRow): PodcastConfig {
  const parsed = parsePodcastConfig(source.podcast_config)
  if ('error' in parsed) throw new Error(parsed.error)
  return parsed.config
}

/** The URL a draft/article for this episode is filed under — its video when known. */
export function episodeSourceUrl(ep: PodcastEpisode, youtubeOverride?: string): string {
  return youtubeOverride || ep.youtubeUrl || ep.link || ep.audioUrl || ''
}

/** Draft/article already filed under any of this episode's URLs, if one exists. */
export async function existingForEpisode(supabase: Service, ep: PodcastEpisode, youtubeOverride?: string) {
  const urls = [...new Set([episodeSourceUrl(ep, youtubeOverride), ep.link, ep.youtubeUrl].filter((u): u is string => !!u))]
  const [{ data: d }, { data: a }] = await Promise.all([
    supabase.from('drafts').select('id').in('source_url', urls).limit(1),
    supabase.from('articles').select('slug').in('source_url', urls).limit(1),
  ])
  return { draftId: d?.[0]?.id as string | undefined, slug: a?.[0]?.slug as string | undefined }
}

/**
 * Step 1: Gemini goes through the episode; the notes are saved at once on a
 * pending draft (placeholder body), so the episode is never paid for twice.
 */
export async function createNotesDraft(
  supabase: Service,
  source: SourceRow,
  config: PodcastConfig,
  episode: PodcastEpisode,
  opts: { transcript?: string; youtubeUrl?: string } = {},
): Promise<{ draftId: string; media: EpisodeMedia['kind'] }> {
  const youtubeUrl = opts.youtubeUrl || episode.youtubeUrl
  const media: EpisodeMedia | null = opts.transcript
    ? { kind: 'transcript', text: opts.transcript }
    : youtubeUrl
      ? { kind: 'youtube', url: youtubeUrl }
      : episode.audioUrl
        ? { kind: 'audio', url: episode.audioUrl, mimeType: episode.audioType }
        : null
  if (!media) throw new StepError(400, 'No YouTube video or audio found for this episode — add the YouTube URL or paste a transcript')

  const notes = await extractPodcastNotes(supabase, config, episode, media)
  if (!notes) throw new StepError(422, 'Gemini judged this episode unusable (no real content found)')
  console.log(`[podcast] notes for "${episode.title}" from ${media.kind}: ${notes.length} chars`)

  const { data: draft, error } = await supabase
    .from('drafts')
    .insert({
      title: episode.title,
      slug: await uniqueSlug(slugify(episode.title), 'drafts', supabase),
      content: WRITING_PLACEHOLDER,
      source_url: episodeSourceUrl(episode, opts.youtubeUrl),
      source_feed_id: source.id,
      source_published_at: episode.pubDate ? new Date(episode.pubDate).toISOString() : null,
      status: 'pending',
      // Re-runs reuse these notes, so the episode is never re-sent to Gemini.
      extracted_facts: notes,
    })
    .select('id')
    .single()
  if (error || !draft) throw new StepError(500, error?.message ?? 'Draft insert failed')
  return { draftId: draft.id, media: media.kind }
}

/** Step 2: writes the article into a step-1 draft from its stored notes (text-only). */
export async function writeNotesDraft(
  supabase: Service,
  config: PodcastConfig,
  draft: DraftRow,
): Promise<{ title: string; words: number }> {
  const notes = typeof draft.extracted_facts === 'string' ? draft.extracted_facts.trim() : ''
  if (!notes) throw new StepError(400, 'Draft has no episode notes')

  const { title, content: written } = await writePodcastArticle(supabase, config, {
    // Step 1 stores the episode title as the draft title.
    episodeTitle: draft.title,
    episodeYouTubeUrl: draft.source_url && isYouTubeUrl(draft.source_url) ? draft.source_url : null,
    notes,
  })
  const content = linkifyCompanyMentions(written, await getDirectoryEntries(supabase))
  const { error } = await supabase
    .from('drafts')
    .update({
      title,
      slug: await uniqueSlug(slugify(title), 'drafts', supabase),
      content,
      excerpt: extractTeaser(content) || null,
    })
    .eq('id', draft.id)
  if (error) throw new StepError(500, error.message)
  return { title, words: content.split(/\s+/).filter(Boolean).length }
}

export class StepError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

export type AutoStepResult =
  | { action: 'idle' }
  | { action: 'notes'; source: string; draft_id: string; episode: string }
  | { action: 'written'; source: string; draft_id: string; title: string; published: string | null }
  | { action: 'error'; source: string; error: string; episode?: string; draft_id?: string }

/**
 * One unit of automatic work for a podcast source — at most ONE Gemini call,
 * so it always fits a single function. Callers loop until it reports `idle`.
 *   1. finish a step-1 draft still carrying the placeholder (write it up, and
 *      publish it if the source auto-publishes);
 *   2. otherwise take the oldest new full episode after the baseline that has
 *      no draft/article yet, and run step 1 on it.
 * Episodes at or before `ignore_before` are never touched.
 */
export async function autoStep(supabase: Service, source: SourceRow): Promise<AutoStepResult> {
  let config: PodcastConfig
  try {
    config = loadConfig(source)
  } catch (err) {
    return { action: 'error', source: source.name, error: err instanceof Error ? err.message : String(err) }
  }

  const { data: unfinished } = await supabase
    .from('drafts')
    .select('id, title, source_url, source_feed_id, extracted_facts, content')
    .eq('source_feed_id', source.id)
    .eq('status', 'pending')
    .eq('content', WRITING_PLACEHOLDER)
    .order('created_at', { ascending: true })
    .limit(1)
  const draft = unfinished?.[0] as DraftRow | undefined
  if (draft) {
    try {
      const { title } = await writeNotesDraft(supabase, config, draft)
      let published: string | null = null
      if (source.auto_publish) {
        const result = await approveDraft(supabase, draft.id)
        if (result.status === 'ok') {
          await supabase.from('drafts').update({ status: 'approved' }).eq('id', draft.id)
          published = result.slug
        } else {
          console.error(`[podcast] auto-publish failed for draft ${draft.id}: ${result.message}`)
        }
      }
      return { action: 'written', source: source.name, draft_id: draft.id, title, published }
    } catch (err) {
      return { action: 'error', source: source.name, draft_id: draft.id, error: err instanceof Error ? err.message : String(err) }
    }
  }

  let episodes: PodcastEpisode[]
  try {
    episodes = await listEpisodes(source.url, config)
  } catch (err) {
    return { action: 'error', source: source.name, error: `Could not read feed: ${err instanceof Error ? err.message : String(err)}` }
  }
  // Without a baseline the whole back catalogue would qualify — refuse rather
  // than generate every episode in the feed.
  if (!config.ignore_before) {
    return { action: 'error', source: source.name, error: 'Set podcast_config.ignore_before before running automatically' }
  }
  const candidates = episodes.filter(e => !isBeforeBaseline(e, config)).reverse() // oldest new first
  for (const ep of candidates) {
    const existing = await existingForEpisode(supabase, ep)
    if (existing.draftId || existing.slug) continue
    try {
      const { draftId } = await createNotesDraft(supabase, source, config, ep)
      return { action: 'notes', source: source.name, draft_id: draftId, episode: ep.title }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      // File the failure as a rejected draft so the schedule doesn't pay for the
      // same failing episode three times a day; "Generate again" still retries it.
      await supabase.from('drafts').insert({
        title: ep.title,
        slug: await uniqueSlug(slugify(ep.title), 'drafts', supabase),
        content: `_Automatic generation failed: ${message}_\n\nRetry from /admin/sources → Episodes → Generate again.`,
        source_url: episodeSourceUrl(ep),
        source_feed_id: source.id,
        source_published_at: ep.pubDate ? new Date(ep.pubDate).toISOString() : null,
        status: 'rejected',
      })
      return { action: 'error', source: source.name, episode: ep.title, error: message }
    }
  }
  return { action: 'idle' }
}
