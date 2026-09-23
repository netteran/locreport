import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { slugify, uniqueSlug } from '@/lib/slugify'
import { extractTeaser } from '@/lib/utils'
import { getDirectoryEntries, linkifyCompanyMentions } from '@/lib/companyLinks'
import { isYouTubeUrl, parsePodcastConfig, writePodcastArticle } from '@/lib/podcast'

type Params = { params: Promise<{ id: string }> }

export const maxDuration = 300

/**
 * Step 2 of 2: writes the article into a draft that /api/podcasts/[id]/ingest
 * created with the episode notes. Text-only, so it never pays for the episode
 * again. Same guard rails as step 1: admin session only, draft stays pending.
 *
 * Body: { draft_id: string }
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params

  const session = await createClient()
  const { data: { user } } = await session.auth.getUser()
  if (!user || user.email !== process.env.ADMIN_EMAIL) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let draftId = ''
  try {
    const body = await req.json()
    if (typeof body?.draft_id === 'string') draftId = body.draft_id
  } catch {
    // fall through to the validation below
  }
  if (!draftId) return NextResponse.json({ error: 'draft_id is required' }, { status: 400 })

  const supabase = createServiceClient()
  const [{ data: source }, { data: draft }] = await Promise.all([
    supabase.from('rss_sources').select('*').eq('id', id).maybeSingle(),
    supabase.from('drafts').select('*').eq('id', draftId).maybeSingle(),
  ])
  if (!source || source.kind !== 'podcast') {
    return NextResponse.json({ error: 'Podcast source not found' }, { status: 404 })
  }
  if (!draft || draft.source_feed_id !== source.id) {
    return NextResponse.json({ error: 'Draft not found for this podcast' }, { status: 404 })
  }
  const notes = typeof draft.extracted_facts === 'string' ? draft.extracted_facts.trim() : ''
  if (!notes) return NextResponse.json({ error: 'Draft has no episode notes' }, { status: 400 })
  const parsed = parsePodcastConfig(source.podcast_config)
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })

  try {
    const { title, content: written } = await writePodcastArticle(supabase, parsed.config, {
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
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({
      draft_id: draft.id,
      title,
      model: parsed.config.model,
      words: content.split(/\s+/).filter(Boolean).length,
    })
  } catch (err) {
    console.error(`[podcast] write-up failed for draft ${draft.id}:`, err)
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err), draft_id: draft.id }, { status: 500 })
  }
}
