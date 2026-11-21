import { requireAdmin, unauthorized, requireResearchSchema } from '@/lib/adminAuth'
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { slugify, uniqueSlug } from '@/lib/slugify'
import { embedAndStoreArticle } from '@/lib/embeddings'
import { ensureArticleFact } from '@/lib/factFlow'
import { getDirectoryEntries, linkifyCompanyMentions } from '@/lib/companyLinks'
import { resolvePublicArticle } from '@/lib/articleLookup'
import { articleHref, getContentType, isContentType } from '@/lib/contentTaxonomy'
import { validateEditorialProtocol } from '@/lib/editorialProtocol'
import { revalidateArticleSurfaces } from '@/lib/revalidate'

export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get('slug')
  if (!slug) return NextResponse.json({ error: 'slug param required' }, { status: 400 })

  const supabase = await createClient()
  const {
    data: { user }
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const svc = createServiceClient()
  const schemaResponse = await requireResearchSchema(svc)
  if (schemaResponse) return schemaResponse
  const { data: exact, error } = await svc
    .from('articles')
    .select('id, slug, title, article_type, content_type, content_slug')
    .eq('slug', slug)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const found = exact ?? await resolvePublicArticle([slug]).catch(() => null)
  if (!found) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ...found, contentType: getContentType(found), href: articleHref(found) })
}

export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) return unauthorized()
  const { content, contentType = 'analysis', source_url = null } = await req.json()
  if (typeof content !== 'string' || (source_url !== null && typeof source_url !== 'string')
    || !isContentType(contentType) || contentType === 'report') {
    return NextResponse.json({ error: 'Provide content and choose brief or analysis. Create reports in the monthly reporting workspace.' }, { status: 400 })
  }
  try {
    validateEditorialProtocol(contentType, content, source_url)
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 })
  }
  const titleMatch = content.match(/^#\s+(.+)$/m)
  const title = titleMatch ? titleMatch[1].trim() : 'Untitled'
  const supabase = createServiceClient()
  const schemaResponse = await requireResearchSchema(supabase)
  if (schemaResponse) return schemaResponse
  const slug = await uniqueSlug(slugify(title) || 'untitled', 'articles', supabase)
  const directoryEntries = await getDirectoryEntries(supabase)
  const linkedContent = linkifyCompanyMentions(content, directoryEntries)
  const { data, error } = await supabase
    .from('articles')
    .insert({
      title,
      slug,
      content: linkedContent,
      article_type: 'industry',
      content_type: contentType,
      source_url,
      author: 'LocReport Editorial Desk',
      publisher: 'LocReport'
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  // Same guarantee as the draft-approval path: an article never goes live
  // without its one Fact Flow entry. No draft here, so it distils from the body.
  await ensureArticleFact(supabase, {
    articleId: data.id,
    title,
    content: linkedContent,
    sourceUrl: source_url,
  })
  await embedAndStoreArticle(supabase, data.id)
  revalidateArticleSurfaces(data)
  return NextResponse.json({ ...data, contentType, href: articleHref(data) }, { status: 201 })
}
