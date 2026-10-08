import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { embedAndStoreArticle } from '@/lib/embeddings'
import { revalidateArticleSurfaces } from '@/lib/revalidate'
import { deleteArticles } from '@/lib/deleteArticles'

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
  try {
    await deleteArticles(supabase, [id])
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 })
  }
  return new NextResponse(null, { status: 204 })
}
