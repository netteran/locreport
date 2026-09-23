import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { isBeforeBaseline, isYouTubeUrl, listEpisodes } from '@/lib/podcast'
import { createNotesDraft, existingForEpisode, loadConfig, StepError } from '@/lib/podcastRun'

type Params = { params: Promise<{ id: string }> }

export const maxDuration = 300

const MIN_TRANSCRIPT_CHARS = 500

/**
 * Manual step 1 of 2 (the Episodes list's "Generate draft"): Gemini goes
 * through ONE episode and its notes are saved on a pending draft;
 * /api/podcasts/[id]/write then writes the article into it. Split because an
 * hour-long episode and its write-up did not fit one 300 s Vercel function.
 *   - admin session only (the scheduled path is /api/podcasts/auto);
 *   - always leaves the draft `pending`;
 *   - refuses an episode that already has a draft or article unless `force`;
 *   - always refuses an episode published at or before `ignore_before`.
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

  try {
    const config = loadConfig(source)
    let episode
    try {
      episode = (await listEpisodes(source.url, config)).find(e => e.id === episodeId)
    } catch (err) {
      return NextResponse.json({ error: `Could not read feed: ${err instanceof Error ? err.message : String(err)}` }, { status: 502 })
    }
    if (!episode) return NextResponse.json({ error: 'Episode not found in feed' }, { status: 404 })
    // Hard stop, not overridable by `force`: the back catalogue is covered by hand.
    if (isBeforeBaseline(episode, config)) {
      return NextResponse.json({ error: `This episode predates the source's ignore_before baseline (${config.ignore_before}) and is never generated` }, { status: 409 })
    }

    // Checked before anything costs tokens.
    if (body.force !== true) {
      const existing = await existingForEpisode(supabase, episode, youtubeOverride)
      if (existing.draftId || existing.slug) {
        return NextResponse.json({ error: 'This episode already has a draft or article', draft_id: existing.draftId ?? null, slug: existing.slug ?? null }, { status: 409 })
      }
    }

    const { draftId, media } = await createNotesDraft(supabase, source, config, episode, {
      transcript: pasted || undefined,
      youtubeUrl: youtubeOverride || undefined,
    })
    return NextResponse.json({ draft_id: draftId, media, model: config.model })
  } catch (err) {
    console.error(`[podcast] step 1 failed for source ${id}:`, err)
    const status = err instanceof StepError ? err.status : 500
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status })
  }
}
