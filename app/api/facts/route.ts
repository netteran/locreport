import { requireAdmin, unauthorized, requireResearchSchema } from '@/lib/adminAuth'
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { revalidateFactSurfaces } from '@/lib/revalidate'
import { resolvePublicArticle } from '@/lib/articleLookup'
import { articleHref, type PostReference } from '@/lib/contentTaxonomy'

export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) return unauthorized()

  const body = await req.json()
  const content = typeof body.content === 'string' ? body.content.trim() : ''
  const source_url = typeof body.source_url === 'string' ? body.source_url.trim() || null : null
  const slug = typeof body.slug === 'string' ? body.slug.trim() || null : null

  if (!content) return NextResponse.json({ error: 'content is required' }, { status: 400 })
  if (source_url) {
    try { const url = new URL(source_url); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error() }
    catch { return NextResponse.json({ error: 'Use a valid http or https source URL' }, { status: 400 }) }
  }

  const svc = createServiceClient()
  let article: (PostReference & { id: string }) | null = null

  if (slug) {
    const { data: exact } = await svc.from('articles')
      .select('id,slug,article_type,content_type,content_slug').eq('slug', slug).maybeSingle()
    article = exact ?? await resolvePublicArticle([slug]).catch(() => null)
    if (!article)
      return NextResponse.json({ error: 'Article not found for that slug' }, { status: 404 })
  }

  const schemaResponse = await requireResearchSchema(svc)
  if (schemaResponse) return schemaResponse
  const { data, error } = await svc
    .from('facts')
    .insert({ content, source_url, article_id: article?.id ?? null, category: 'news', status: 'pending' })
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // New manual facts await an explicit Publish action, independently of article links.
  revalidateFactSurfaces()

  return NextResponse.json({ ...data, articles: article ? [{ slug: article.slug, href: articleHref(article) }] : null }, { status: 201 })
}
