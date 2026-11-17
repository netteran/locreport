import { requireAdmin, requireResearchSchema } from '@/lib/adminAuth'
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { revalidateFactSurfaces } from '@/lib/revalidate'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  let body: Record<string, unknown>
  try { body = await req.json(); if (!body || Array.isArray(body) || typeof body !== 'object') throw new Error() }
  catch { return NextResponse.json({ error: 'Invalid fact update' }, { status: 400 }) }
  const patch: Record<string, unknown> = {}
  if ('content' in body) {
    if (typeof body.content !== 'string' || !body.content.trim()) return NextResponse.json({ error: 'Content must not be empty' }, { status: 400 })
    patch.content = body.content.trim()
  }
  if ('source_url' in body) {
    if (body.source_url !== null && typeof body.source_url !== 'string') return NextResponse.json({ error: 'Source URL must be text' }, { status: 400 })
    const raw = typeof body.source_url === 'string' ? body.source_url.trim() : ''
    if (raw) {
      try { const url = new URL(raw); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error(); patch.source_url = url.href }
      catch { return NextResponse.json({ error: 'Use a valid http or https source URL' }, { status: 400 }) }
    } else patch.source_url = null
  }
  if ('article_id' in body) {
    if (body.article_id !== null && (typeof body.article_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.article_id)))
      return NextResponse.json({ error: 'Invalid article' }, { status: 400 })
    patch.article_id = body.article_id
  }
  if ('status' in body) {
    if (!['pending', 'published', 'rejected', 'withdrawn'].includes(String(body.status))) return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    patch.status = body.status
  }
  if (!Object.keys(patch).length) return NextResponse.json({ error: 'No fact changes supplied' }, { status: 400 })
  const svc = createServiceClient()
  const schemaResponse = await requireResearchSchema(svc)
  if (schemaResponse) return schemaResponse
  const { data: current, error: readError } = await svc.from('facts').select('source_url,article_id,published_at,status').eq('id', id).single()
  if (readError || !current) return NextResponse.json({ error: readError?.message || 'Fact not found' }, { status: readError && readError.code !== 'PGRST116' ? 500 : 404 })
  const effective = { ...current, ...patch }
  if (effective.status === 'published' && !effective.source_url && !effective.article_id) {
    const association = 'article_id' in patch ? { data: [], error: null } : await svc.from('fact_article_links').select('article_id').eq('fact_id', id).limit(1)
    if (association.error) return NextResponse.json({ error: association.error.message }, { status: 500 })
    if (!association.data?.length) return NextResponse.json({ error: 'A published fact needs an original source or published article' }, { status: 400 })
  }
  if (patch.status === 'published') { patch.published_at = current.published_at || new Date().toISOString(); patch.review_reason = null }
  const { error } = await svc.from('facts').update(patch).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if ('article_id' in patch) {
    const result = patch.article_id
      ? await svc.from('fact_article_links').upsert({ fact_id: id, article_id: patch.article_id }, { onConflict: 'fact_id,article_id' })
      : await svc.from('fact_article_links').delete().eq('fact_id', id)
    if (result.error) { revalidateFactSurfaces(); return NextResponse.json({ error: 'Fact saved, but its article link could not be updated. Reload before retrying.' }, { status: 500 }) }
  }
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
