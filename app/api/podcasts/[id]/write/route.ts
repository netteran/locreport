import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { loadConfig, StepError, writeNotesDraft } from '@/lib/podcastRun'

type Params = { params: Promise<{ id: string }> }

export const maxDuration = 300

/**
 * Manual step 2 of 2: writes the article into a draft that
 * /api/podcasts/[id]/ingest created with the episode notes. Text-only, so it
 * never pays for the episode again. Admin session only; draft stays pending.
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

  try {
    const config = loadConfig(source)
    const { title, words } = await writeNotesDraft(supabase, config, draft)
    return NextResponse.json({ draft_id: draft.id, title, model: config.model, words })
  } catch (err) {
    console.error(`[podcast] write-up failed for draft ${draft.id}:`, err)
    const status = err instanceof StepError ? err.status : 500
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err), draft_id: draft.id }, { status })
  }
}
