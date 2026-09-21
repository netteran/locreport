import type { createServiceClient } from '@/lib/supabase/server'
import { slugify, uniqueSlug } from '@/lib/slugify'
import { extractTeaser } from '@/lib/utils'
import { classifyArticle } from '@/lib/classify'
import { getOpenAI } from '@/lib/openai'
import { embedAndStoreArticle } from '@/lib/embeddings'
import { ensureArticleFact } from '@/lib/factFlow'
import { getDirectoryEntries, linkifyCompanyMentions } from '@/lib/companyLinks'
import { revalidateArticleSurfaces } from '@/lib/revalidate'

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
 * approval (/api/drafts/[id]) and an automatic one (ingest, for sources with
 * rss_sources.auto_publish) can never drift apart. Never throws — a bad draft
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

    const content = overrides.content ?? draft.content
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
    if (articleError) return { status: 'error', message: articleError.message }

    const { data: articleRow } = await supabase
      .from('articles')
      .select('id')
      .eq('draft_id', draft.id)
      .single()

    if (articleRow?.id) {
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
