import { requireAdmin, requireResearchSchema } from '@/lib/adminAuth'
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { revalidateFactSurfaces } from '@/lib/revalidate'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json()
  const content = typeof body.content === 'string' ? body.content.trim() : undefined
  const hasArticleId = 'article_id' in body
  const article_id = hasArticleId ? (body.article_id ?? null) : undefined

  if (content === undefined && !hasArticleId && !('status' in body))
    return NextResponse.json({ error: 'content or article_id is required' }, { status: 400 })
  if (content !== undefined && !content)
    return NextResponse.json({ error: 'content must not be empty' }, { status: 400 })

  const patch: Record<string, unknown> = {}
  if (content !== undefined) patch.content = content
  if (hasArticleId) patch.article_id = article_id

  const svc = createServiceClient()
  const schemaResponse = await requireResearchSchema(svc)
  if (schemaResponse) return schemaResponse
  if ('status' in body) {
    if (!['pending', 'published', 'rejected', 'withdrawn'].includes(body.status))
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    const { data: current, error: readError } = await svc
      .from('facts')
      .select('source_url,article_id,published_at')
      .eq('id', id)
      .single()
    if (readError) return NextResponse.json({ error: readError.message }, { status: 404 })
    if (body.status === 'published' && !current.source_url && !current.article_id)
      return NextResponse.json(
        { error: 'Add an original source before publishing' },
        { status: 400 }
      )
    patch.status = body.status
    if (body.status === 'published') {
      patch.published_at = current.published_at || new Date().toISOString()
      patch.review_reason = null
    }
  }
  const { error } = await svc.from('facts').update(patch).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (hasArticleId && article_id) {
    await svc
      .from('fact_article_links')
      .upsert({ fact_id: id, article_id }, { onConflict: 'fact_id,article_id' })
  } else if (hasArticleId) {
    await svc.from('fact_article_links').delete().eq('fact_id', id)
  }
  // A patch can link, relink or unlink the fact, so either the old or the new
  // state may have been public. Not worth a read to find out — this is a rare
  // admin edit and revalidating just marks two cache entries stale.
  revalidateFactSurfaces()

  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const svc = createServiceClient()
  const schemaResponse = await requireResearchSchema(svc)
  if (schemaResponse) return schemaResponse
  const { data: current } = await svc.from('facts').select('event_id').eq('id', id).single()
  if (current?.event_id)
    return NextResponse.json(
      { error: 'Keep event history: reject or withdraw this fact instead of deleting it' },
      { status: 400 }
    )
  const { error } = await svc.from('facts').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  revalidateFactSurfaces()

  return NextResponse.json({ ok: true })
}
