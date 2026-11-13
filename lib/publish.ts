import type { createServiceClient } from '@/lib/supabase/server'
import { slugify, uniqueSlug } from '@/lib/slugify'
import { extractTeaser } from '@/lib/utils'
import { classifyArticle } from '@/lib/classify'
import { getOpenAI } from '@/lib/openai'
import { embedAndStoreArticle } from '@/lib/embeddings'
import { ensureArticleFact } from '@/lib/factFlow'
import { getDirectoryEntries, linkifyCompanyMentions } from '@/lib/companyLinks'
import { revalidateArticleSurfaces } from '@/lib/revalidate'
import { draftSourceName } from '@/lib/sourceName'
import { canonicalSourceUrl, validateSourceCitations } from '@/lib/eventMatching'

type Service = ReturnType<typeof createServiceClient>

export interface ApproveDraftOverrides {
  title?: string
  content?: string
  slug?: string
  excerpt?: string
  publisher?: string
  source_url?: string | null
  image_url?: string | null
  image_alt?: string | null
}

export type ApproveDraftResult =
  | { status: 'ok'; articleId: string; slug: string }
  | { status: 'error'; message: string }

/**
 * Turn a draft into a published article — classify, link directory mentions,
 * insert the article row, promote/distil its Fact Flow fact, embed it, and
 * turn over the caches. This is the one place that logic lives, so a human
 * approval (/api/drafts/[id]) uses a single transactional publication boundary. Never throws — a bad draft
 * should fail this one item, not the caller's loop.
 */
export async function approveDraft(
  supabase: Service,
  draftId: string,
  overrides: ApproveDraftOverrides = {}
): Promise<ApproveDraftResult> {
  try {
    const { data: draft, error: draftError } = await supabase
      .from('drafts')
      .select('*')
      .eq('id', draftId)
      .single()
    if (draftError || !draft) return { status: 'error', message: draftError?.message ?? 'Draft not found' }

    if (draft.research_only) return { status: 'error', message: 'Combine this source from Source candidates' }
    const { data: already } = await supabase.from('articles').select('id,slug').eq('draft_id',draftId).limit(1).maybeSingle()
    if (already) return { status: 'ok', articleId: already.id, slug: already.slug }
    const content = overrides.content ?? draft.content
    let coveredUrls:string[]=[]
    if(draft.composition_id){
      const {data:sources,error}=await supabase.from('composition_sources').select('snapshot').eq('composition_id',draft.composition_id)
      if(error)throw new Error(error.message)
      const urls=(sources||[]).map(s=>s.snapshot.source_url as string)
      const used=validateSourceCitations(content,urls)
      coveredUrls=urls.filter(url=>used.has(canonicalSourceUrl(url)))
    }
    const titleMatch = content.match(/^#\s+(.+)$/m)
    const title = overrides.title?.trim() || titleMatch?.[1]?.trim() || draft.title || 'Untitled'
    const baseSlug = overrides.slug?.trim() || slugify(title)
    const slug = await uniqueSlug(baseSlug, 'articles', supabase)
    const excerpt = overrides.excerpt?.trim() || extractTeaser(content)
    const publisher = overrides.publisher?.trim() || 'LocReport'
    const source_url = overrides.source_url !== undefined ? overrides.source_url : draft.source_url
    const image_url = (overrides.image_url !== undefined ? overrides.image_url : draft.image_url) || null
    const image_alt = (overrides.image_alt !== undefined ? overrides.image_alt : draft.image_alt) || null

    const author = draft.source_feed_id
      ? 'LocReport Industry Desk'
      : 'LocReport Editorial Desk'

    const openai = getOpenAI()
    const classification = await classifyArticle(openai, content)
    const directoryEntries = await getDirectoryEntries(supabase)
    const linkedContent = linkifyCompanyMentions(content, directoryEntries)

    const { data: publishedId, error: articleError } = await supabase.rpc('publish_editorial_draft', { p_draft: draftId, p_article: {
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
      covered_urls:coveredUrls,
    } })
    if (articleError) return { status: 'error', message: articleError.message }
    const articleRow = { id: publishedId as string }

    if (articleRow?.id) {
      const sourceName = await draftSourceName(supabase, draft)

      const factResult = draft.composition_id ? null : await ensureArticleFact(supabase, {
        articleId: articleRow.id,
        title,
        content: linkedContent,
        sourceUrl: source_url,
        sourceName,
        draftId: draft.id,
        factSheet: draft.extracted_facts,
      })
      if (factResult?.status === 'skipped') {
        console.warn(`[publish] no Fact Flow fact for article ${articleRow.id}: ${factResult.reason}`)
      }

      await embedAndStoreArticle(supabase, articleRow.id)
    }

    revalidateArticleSurfaces({ slug })

    return { status: 'ok', articleId: articleRow?.id ?? '', slug }
  } catch (err) {
    console.error(`[publish] approveDraft failed for draft ${draftId}:`, err)
    return { status: 'error', message: err instanceof Error ? err.message : String(err) }
  }
}
