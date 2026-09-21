import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { findDraftFact, saveDraftFact } from '@/lib/factFlow'
import { revalidateFactSurfaces } from '@/lib/revalidate'
import { approveDraft } from '@/lib/publish'

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params
  const supabase = createServiceClient()
  const { data, error } = await supabase.from('drafts').select('*').eq('id', id).single()
  if (error) return NextResponse.json({ error: error.message }, { status: 404 })
  // The draft's Fact Flow fact, reviewed and edited alongside the article body —
  // see saveDraftFact below for how an edit here reaches the same row.
  const fact = await findDraftFact(supabase, id)
  return NextResponse.json({ ...data, fact })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params
  const body = await req.json()
  const supabase = createServiceClient()

  // Save the reviewer's edit to the draft's Fact Flow fact before anything else.
  // This must run before the approve branch below, which promotes whatever is
  // currently parked on the draft — so an edit submitted together with the
  // approval has to land first for approval to publish the edited sentence
  // rather than the original distillation.
  let draftFactResult: Awaited<ReturnType<typeof saveDraftFact>> | null = null
  if (body.fact !== undefined) {
    draftFactResult = await saveDraftFact(supabase, { draftId: id, content: body.fact })
    if (draftFactResult.status === 'refused' || draftFactResult.status === 'failed') {
      return NextResponse.json({ error: draftFactResult.reason ?? 'Could not save fact' }, { status: 400 })
    }
  }

  if (body.status === 'approved') {
    const result = await approveDraft(supabase, id, {
      title: body.title,
      content: body.content,
      slug: body.slug,
      excerpt: body.excerpt,
      publisher: body.publisher,
      source_url: body.source_url,
      image_url: body.image_url,
      image_alt: body.image_alt,
    })
    if (result.status === 'error') return NextResponse.json({ error: result.message }, { status: 400 })
  }

  // A fact edit on an already-published article (post-approval correction) writes
  // straight to the live row, so it needs its own cache turnover. When approval
  // just ran, approveDraft() above already covers the fact pages.
  if (draftFactResult?.published && body.status !== 'approved') {
    revalidateFactSurfaces()
  }

  const patch: Record<string, unknown> = {}
  if (body.status !== undefined) patch.status = body.status
  if (body.content !== undefined) patch.content = body.content
  if (body.title !== undefined) patch.title = body.title
  if (body.source_url !== undefined) patch.source_url = body.source_url
  if (body.image_url !== undefined) patch.image_url = body.image_url || null
  if (body.image_alt !== undefined) patch.image_alt = body.image_alt || null

  const { data, error } = await supabase
    .from('drafts')
    .update(patch)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  // Echo back the fact state too, so the client can sync without a second round
  // trip — mirrors the shape GET returns.
  const fact = await findDraftFact(supabase, id)
  return NextResponse.json({ ...data, fact })
}
