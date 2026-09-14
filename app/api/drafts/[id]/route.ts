import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { slugify, uniqueSlug } from '@/lib/slugify'
import { extractTeaser } from '@/lib/utils'
import { classifyArticle } from '@/lib/classify'
import { getOpenAI } from '@/lib/openai'
import { embedAndStoreArticle } from '@/lib/embeddings'
import { ensureArticleFact } from '@/lib/factFlow'
import { getDirectoryEntries, linkifyCompanyMentions } from '@/lib/companyLinks'

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params
  const supabase = createServiceClient()
  const { data, error } = await supabase.from('drafts').select('*').eq('id', id).single()
  if (error) return NextResponse.json({ error: error.message }, { status: 404 })
  return NextResponse.json(data)
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params
  const body = await req.json()
  const supabase = createServiceClient()

  if (body.status === 'approved') {
    const { data: draft, error: draftError } = await supabase
      .from('drafts')
      .select('*')
      .eq('id', id)
      .single()
    if (draftError) return NextResponse.json({ error: draftError.message }, { status: 404 })

    const content = body.content ?? draft.content
    const titleMatch = content.match(/^#\s+(.+)$/m)
    const title = body.title?.trim() || titleMatch?.[1]?.trim() || draft.title || 'Untitled'
    const baseSlug = body.slug?.trim() || slugify(title)
    const slug = await uniqueSlug(baseSlug, 'articles', supabase)
    const excerpt = body.excerpt?.trim() || extractTeaser(content)
    const publisher = body.publisher?.trim() || 'LocReport'
    const source_url = body.source_url !== undefined ? body.source_url : draft.source_url
    // Optional lead image — falls back to whatever was stored on the draft.
    const image_url = (body.image_url !== undefined ? body.image_url : draft.image_url) || null
    const image_alt = (body.image_alt !== undefined ? body.image_alt : draft.image_alt) || null

    const author = draft.source_feed_id
      ? 'LocReport Industry Desk'
      : 'LocReport Editorial Desk'

    const openai = getOpenAI()
    const classification = await classifyArticle(openai, content)
    // Auto-link mentions of directory companies to their /compass/directory page
    const directoryEntries = await getDirectoryEntries(supabase)
    const linkedContent = linkifyCompanyMentions(content, directoryEntries)

    const { error: articleError } = await supabase.from('articles').insert({
      title,
      slug,
      content: linkedContent,
      excerpt,
      source_url,
      publisher,
      image_url,
      image_alt,
      draft_id: draft.id,
      article_type: 'industry',
      author,
      impact_score: classification.impact_score,
      time_horizon: classification.time_horizon,
      signal_ids: classification.signal_ids,
      business_implications: classification.business_implications,
      affected_segments: classification.affected_segments,
    })
    if (articleError) return NextResponse.json({ error: articleError.message }, { status: 400 })

    const { data: articleRow } = await supabase
      .from('articles')
      .select('id')
      .eq('draft_id', draft.id)
      .single()
    if (articleRow?.id) {
      // Publishing an article and giving it its Fact Flow entry are the same
      // event. ensureArticleFact promotes the fact ingest parked on the draft;
      // if there isn't one — ingest distilled nothing, or the draft was written
      // by hand in /admin/compose or /admin/direct — it distils one now from
      // the pinned Stage 1 sheet, falling back to the article body. That is
      // what stops an article going live with nothing on Fact Flow.
      let sourceName: string | null = null
      if (draft.source_feed_id) {
        const { data: feed } = await supabase
          .from('rss_sources')
          .select('name')
          .eq('id', draft.source_feed_id)
          .maybeSingle()
        sourceName = feed?.name ?? null
      }

      const factResult = await ensureArticleFact(supabase, {
        articleId: articleRow.id,
        title,
        content: linkedContent,
        sourceUrl: source_url,
        sourceName,
        draftId: draft.id,
        factSheet: draft.extracted_facts,
      })
      if (factResult.status === 'skipped') {
        console.warn(`[drafts] no Fact Flow fact for article ${articleRow.id}: ${factResult.reason}`)
      }

      await embedAndStoreArticle(supabase, articleRow.id)
    }
  }

  const patch: Record<string, unknown> = {}
  if (body.status !== undefined) patch.status = body.status
  if (body.content !== undefined) patch.content = body.content
  if (body.title !== undefined) patch.title = body.title
  if (body.source_url !== undefined) patch.source_url = body.source_url
  if (body.image_url !== undefined) patch.image_url = body.image_url || null
  if (body.image_alt !== undefined) patch.image_alt = body.image_alt || null

  const { data, error } = await supabase
    .from('drafts')
    .update(patch)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data)
}
