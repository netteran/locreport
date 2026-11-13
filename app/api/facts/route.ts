import { requireAdmin, unauthorized, requireResearchSchema } from '@/lib/adminAuth'
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { revalidateFactSurfaces } from '@/lib/revalidate'

export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) return unauthorized()

  const body = await req.json()
  const content = typeof body.content === 'string' ? body.content.trim() : ''
  const source_url = typeof body.source_url === 'string' ? body.source_url.trim() || null : null
  const slug = typeof body.slug === 'string' ? body.slug.trim() || null : null

  if (!content) return NextResponse.json({ error: 'content is required' }, { status: 400 })

  let article_id: string | null = null

  if (slug) {
    const svc = createServiceClient()
    const { data: article } = await svc.from('articles').select('id').eq('slug', slug).single()
    if (!article)
      return NextResponse.json({ error: 'Article not found for that slug' }, { status: 404 })
    article_id = article.id
  }

  const svc = createServiceClient()
  const schemaResponse = await requireResearchSchema(svc)
  if (schemaResponse) return schemaResponse
  const { data, error } = await svc
    .from('facts')
    .insert({ content, source_url, article_id, category: 'news', status: 'pending' })
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // New manual facts await an explicit Publish action, independently of article links.
  revalidateFactSurfaces()

  return NextResponse.json(data, { status: 201 })
}
