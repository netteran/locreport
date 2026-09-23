import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getOpenAI } from '@/lib/openai'
import { slugify, uniqueSlug } from '@/lib/slugify'
import { extractTeaser } from '@/lib/utils'
import { getDirectoryEntries, linkifyCompanyMentions } from '@/lib/companyLinks'
import {
  extractPodcastNotes,
  isYouTubeUrl,
  listEpisodes,
  parsePodcastConfig,
  transcribeAudio,
  writePodcastArticle,
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
 * A pasted `transcript` skips audio download + transcription entirely.
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

  const openai = getOpenAI()
  try {
    let transcript = pasted
    if (!transcript) {
      if (!episode.audioUrl) {
        return NextResponse.json({ error: 'This feed has no audio for the episode — paste the transcript instead' }, { status: 400 })
      }
      transcript = await transcribeAudio(openai, episode.audioUrl, episode.audioType, config)
      console.log(`[podcast] transcribed "${episode.title}": ${transcript.length} chars`)
    }

    const notes = await extractPodcastNotes(openai, supabase, config, episode, transcript)
    if (!notes) {
      return NextResponse.json({ error: 'The notes step judged this transcript unusable' }, { status: 422 })
    }

    const { title, content: written } = await writePodcastArticle(openai, supabase, config, {
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
        // Re-runs reuse these notes, so the episode is never re-transcribed.
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
      transcript_source: pasted ? 'pasted' : 'audio',
      transcript_chars: transcript.length,
      words: content.split(/\s+/).filter(Boolean).length,
    })
  } catch (err) {
    console.error(`[podcast] failed for "${episode.title}":`, err)
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
