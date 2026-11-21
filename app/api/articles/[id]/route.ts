import {requireAdmin,unauthorized} from '@/lib/adminAuth'
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { embedAndStoreArticle } from '@/lib/embeddings'
import { revalidateArticleSurfaces } from '@/lib/revalidate'
import { deleteArticles } from '@/lib/deleteArticles'
import { articleHref, getContentType, isContentType, validSlugSegment } from '@/lib/contentTaxonomy'
import { validateEditorialProtocol } from '@/lib/editorialProtocol'

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params
  const supabase = createServiceClient()
  const { data, error } = await supabase.from('articles').select('*').eq('id', id).single()
  if (error) return NextResponse.json({ error: error.message }, { status: 404 })
  return NextResponse.json({ ...data, contentType: getContentType(data), href: articleHref(data) })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  if(!await requireAdmin())return unauthorized()
  const { id } = await params
  const { contentType: requestedType, content_type: storedType, content_slug: _routeSlug, article_type: _articleType, ...body } = await req.json()
  const supabase = createServiceClient()
  const { data: previous, error: lookupError } = await supabase.from('articles')
    .select('slug,content_slug,content_type,article_type,content,source_url').eq('id', id).single()
  if (lookupError || !previous) return NextResponse.json({ error: 'Article not found' }, { status: 404 })

  const oldType = getContentType(previous)
  const contentType: unknown = requestedType ?? storedType ?? oldType
  if (!isContentType(contentType) || (contentType === 'report') !== (oldType === 'report')) {
    return NextResponse.json({ error: 'Choose brief or analysis for a story. Reports use the monthly reporting workspace.' }, { status: 400 })
  }
  if (body.slug !== undefined && body.slug !== previous.slug && (typeof body.slug !== 'string' || !validSlugSegment(body.slug))) {
    return NextResponse.json({ error: 'Use a slug made of letters, numbers, hyphens, underscores, or dots.' }, { status: 400 })
  }
  if ((body.content !== undefined && typeof body.content !== 'string')
    || (body.source_url != null && typeof body.source_url !== 'string')) {
    return NextResponse.json({ error: 'Provide valid article content and source URL.' }, { status: 400 })
  }
  const content = body.content ?? previous.content
  const source = body.source_url === undefined ? previous.source_url : body.source_url
  try {
    if (contentType !== oldType || content !== previous.content || source !== previous.source_url) {
      validateEditorialProtocol(contentType, content, source)
    }
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 })
  }
  const { data, error } = await supabase
    .from('articles')
    .update({ ...body, content_type: contentType })
    .eq('id', id)
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  if (body.title !== undefined || body.excerpt !== undefined || body.content !== undefined) {
    await embedAndStoreArticle(supabase, id)
  }
  // Editing a published article has to turn over its own 24h-cached detail page
  // as well as the listings it appears in.
  revalidateArticleSurfaces(previous, data)
  return NextResponse.json({ ...data, contentType: getContentType(data), href: articleHref(data) })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  if(!await requireAdmin())return unauthorized()
  const { id } = await params
  const supabase = createServiceClient()
  try {
    await deleteArticles(supabase, [id])
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 })
  }
  return new NextResponse(null, { status: 204 })
}
