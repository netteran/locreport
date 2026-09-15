import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { revalidateFactSurfaces } from '@/lib/revalidate'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  return user
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json()
  const content = typeof body.content === 'string' ? body.content.trim() : undefined
  const hasArticleId = 'article_id' in body
  const article_id = hasArticleId ? (body.article_id ?? null) : undefined

  if (content === undefined && !hasArticleId)
    return NextResponse.json({ error: 'content or article_id is required' }, { status: 400 })
  if (content !== undefined && !content)
    return NextResponse.json({ error: 'content must not be empty' }, { status: 400 })

  const patch: Record<string, unknown> = {}
  if (content !== undefined) patch.content = content
  if (hasArticleId) patch.article_id = article_id

  const svc = createServiceClient()
  const { error } = await svc.from('facts').update(patch).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

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
  const { error } = await svc.from('facts').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  revalidateFactSurfaces()

  return NextResponse.json({ ok: true })
}
