import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { revalidateFactSurfaces } from '@/lib/revalidate'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const content = typeof body.content === 'string' ? body.content.trim() : ''
  const source_url = typeof body.source_url === 'string' ? body.source_url.trim() || null : null
  const slug = typeof body.slug === 'string' ? body.slug.trim() || null : null

  if (!content) return NextResponse.json({ error: 'content is required' }, { status: 400 })

  let article_id: string | null = null

  if (slug) {
    const svc = createServiceClient()
    const { data: article } = await svc
      .from('articles')
      .select('id')
      .eq('slug', slug)
      .single()
    if (!article) return NextResponse.json({ error: 'Article not found for that slug' }, { status: 404 })
    article_id = article.id
  }

  const svc = createServiceClient()
  const { data, error } = await svc
    .from('facts')
    .insert({ content, source_url, article_id, category: 'news' })
    .select('id, content, category, source_url, source_name, article_id, created_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Only a fact with an article_id is public, so an unlinked one changes nothing.
  if (article_id) revalidateFactSurfaces()

  return NextResponse.json(data, { status: 201 })
}
