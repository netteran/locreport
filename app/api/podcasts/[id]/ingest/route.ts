import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { slugify, uniqueSlug } from '@/lib/slugify'
import { extractTeaser } from '@/lib/utils'
import { getDirectoryEntries, linkifyCompanyMentions } from '@/lib/companyLinks'
import {
  extractPodcastNotes,
  isYouTubeUrl,
  listEpisodes,
  parsePodcastConfig,
  writePodcastArticle,
  type EpisodeMedia,
} from '@/lib/podcast'

type Params = { params: Promise<{ id: string }> }

export const maxDuration = 300

const MIN_TRANSCRIPT_CHARS = 500

/**
 * Turns ONE podcast episode into a pending draft. Manual-only by design:
 *   - admin session required; CRON_SECRET is deliberately not accepted, so no
 *     scheduled job can reach this and spend tokens;
 *   - always leaves the draft `pending` — the source's auto_publish is ignored;
 *   - refuses an episode that already has a draft or article unless `force`.
 *
 * Body: { episode_id: string, transcript?: string, youtube_url?: string, force?: boolean }
 * What Gemini gets, in order: a pasted `transcript`, else the episode's YouTube
 * video (from the feed, or `youtube_url`), else its audio file.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params

  const session = await createClient()
  const { data: { user } } = await session.auth.getUser()
  if (!user || user.email !== process.env.ADMIN_EMAIL) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { episode_id?: unknown; transcript?: unknown; youtube_url?: unknown; force?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'JSON body required' }, { status: 400 })
  }
  const episodeId = typeof body.episode_id === 'string' ? body.episode_id : ''
  const pasted = typeof body.transcript === 'string' ? body.transcript.trim() : ''
  const youtubeOverride = typeof body.youtube_url === 'string' ? body.youtube_url.trim() : ''
  if (!episodeId) return NextResponse.json({ error: 'episode_id is required' }, { status: 400 })
  if (pasted && pasted.length < MIN_TRANSCRIPT_CHARS) {
    return NextResponse.json({ error: `Pasted transcript is too short (${pasted.length} chars)` }, { status: 400 })
  }
  if (youtubeOverride && !isYouTubeUrl(youtubeOverride)) {
    return NextResponse.json({ error: 'youtube_url must be a youtube.com / youtu.be link' }, { status: 400 })
  }

  const supabase = createServiceClient()
  const { data: source } = await supabase.from('rss_sources').select('*').eq('id', id).maybeSingle()
  if (!source || source.kind !== 'podcast') {
    return NextResponse.json({ error: 'Podcast source not found' }, { status: 404 })
  }
  if (!source.active) return NextResponse.json({ error: 'Source is disabled' }, { status: 400 })
  const parsed = parsePodcastConfig(source.podcast_config)
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const config = parsed.config

  let episode
  try {
    episode = (await listEpisodes(source.url, config)).find(e => e.id === episodeId)
  } catch (err) {
    return NextResponse.json({ error: `Could not read feed: ${err instanceof Error ? err.message : String(err)}` }, { status: 502 })
  }
  if (!episode) return NextResponse.json({ error: 'Episode not found in feed' }, { status: 404 })

  const youtubeUrl = youtubeOverride || episode.youtubeUrl
  const sourceUrl = youtubeUrl || episode.link || episode.audioUrl

  // Checked before anything costs tokens.
  if (body.force !== true) {
    const candidates = [...new Set([sourceUrl, episode.link, episode.youtubeUrl].filter((u): u is string => !!u))]
    const [{ data: d }, { data: a }] = await Promise.all([
      supabase.from('drafts').select('id').in('source_url', candidates).limit(1),
      supabase.from('articles').select('slug').in('source_url', candidates).limit(1),
    ])
    if (d?.length || a?.length) {
      return NextResponse.json({ error: 'This episode already has a draft or article', draft_id: d?.[0]?.id ?? null, slug: a?.[0]?.slug ?? null }, { status: 409 })
    }
  }

  const media: EpisodeMedia | null = pasted
    ? { kind: 'transcript', text: pasted }
    : youtubeUrl
      ? { kind: 'youtube', url: youtubeUrl }
      : episode.audioUrl
        ? { kind: 'audio', url: episode.audioUrl, mimeType: episode.audioType }
        : null
  if (!media) {
    return NextResponse.json({ error: 'No YouTube video or audio found for this episode — add the YouTube URL or paste a transcript' }, { status: 400 })
  }

  try {
    const notes = await extractPodcastNotes(supabase, config, episode, media)
    if (!notes) {
      return NextResponse.json({ error: 'Gemini judged this episode unusable (no real content found)' }, { status: 422 })
    }
    console.log(`[podcast] notes for "${episode.title}" from ${media.kind}: ${notes.length} chars`)

    const { title, content: written } = await writePodcastArticle(supabase, config, {
      episodeTitle: episode.title,
      episodeYouTubeUrl: youtubeUrl,
      notes,
    })
    const content = linkifyCompanyMentions(written, await getDirectoryEntries(supabase))
    const slug = await uniqueSlug(slugify(title), 'drafts', supabase)

    const { data: draft, error } = await supabase
      .from('drafts')
      .insert({
        title,
        slug,
        content,
        excerpt: extractTeaser(content) || null,
        source_url: sourceUrl,
        source_feed_id: source.id,
        source_published_at: episode.pubDate ? new Date(episode.pubDate).toISOString() : null,
        status: 'pending',
        // Re-runs reuse these notes, so the episode is never re-sent to Gemini.
        extracted_facts: notes,
      })
      .select('id')
      .single()
    if (error || !draft) {
      return NextResponse.json({ error: error?.message ?? 'Draft insert failed' }, { status: 500 })
    }

    return NextResponse.json({
      draft_id: draft.id,
      title,
      media: media.kind,
      model: config.model,
      words: content.split(/\s+/).filter(Boolean).length,
    })
  } catch (err) {
    console.error(`[podcast] failed for "${episode.title}":`, err)
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
