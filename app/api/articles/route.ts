import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { slugify, uniqueSlug } from '@/lib/slugify'
import { embedAndStoreArticle } from '@/lib/embeddings'
import { ensureArticleFact } from '@/lib/factFlow'
import { getDirectoryEntries, linkifyCompanyMentions } from '@/lib/companyLinks'

export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get('slug')
  if (!slug) return NextResponse.json({ error: 'slug param required' }, { status: 400 })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const svc = createServiceClient()
  const { data, error } = await svc
    .from('articles')
    .select('id, slug, title')
    .eq('slug', slug)
    .single()

  if (error || !data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const { content } = await req.json()
  const titleMatch = content.match(/^#\s+(.+)$/m)
  const title = titleMatch ? titleMatch[1].trim() : 'Untitled'
  const supabase = createServiceClient()
  const slug = await uniqueSlug(slugify(title), 'articles', supabase)
  const directoryEntries = await getDirectoryEntries(supabase)
  const linkedContent = linkifyCompanyMentions(content, directoryEntries)
  const { data, error } = await supabase
    .from('articles')
    .insert({ title, slug, content: linkedContent, article_type: 'industry', author: 'LocReport Editorial Desk', publisher: 'LocReport' })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  // Same guarantee as the draft-approval path: an article never goes live
  // without its one Fact Flow entry. No draft here, so it distils from the body.
  await ensureArticleFact(supabase, {
    articleId: data.id,
    title,
    content: linkedContent,
  })
  await embedAndStoreArticle(supabase, data.id)
  return NextResponse.json(data, { status: 201 })
}
