import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { embedAndStoreArticle } from '@/lib/embeddings'
import { revalidateArticleSurfaces } from '@/lib/revalidate'

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params
  const supabase = createServiceClient()
  const { data, error } = await supabase.from('articles').select('*').eq('id', id).single()
  if (error) return NextResponse.json({ error: error.message }, { status: 404 })
  return NextResponse.json(data)
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params
  const body = await req.json()
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('articles')
    .update(body)
    .eq('id', id)
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  if (body.title !== undefined || body.excerpt !== undefined || body.content !== undefined) {
    await embedAndStoreArticle(supabase, id)
  }
  // Editing a published article has to turn over its own 24h-cached detail page
  // as well as the listings it appears in.
  revalidateArticleSurfaces({ slug: data?.slug, monthlyReport: data?.article_type === 'monthly-summary' })
  return NextResponse.json(data)
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params
  const supabase = createServiceClient()
  // Read the slug before the row goes, so the deleted article's cached detail
  // page can be dropped too rather than serving a ghost for another 24h.
  const { data: existing } = await supabase
    .from('articles')
    .select('slug, article_type')
    .eq('id', id)
    .maybeSingle()
  const { error } = await supabase.from('articles').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  revalidateArticleSurfaces({
    slug: existing?.slug,
    monthlyReport: existing?.article_type === 'monthly-summary',
  })
  return new NextResponse(null, { status: 204 })
}
