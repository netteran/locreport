import type { SupabaseClient } from '@supabase/supabase-js'
import { articleHref, type PostReference } from '@/lib/contentTaxonomy'
import { missingPublicationColumns, RESEARCH_MIGRATION } from '@/lib/researchSchema'

export interface AdminFact {
  id: string
  content: string
  category: string
  source_name: string | null
  source_url: string | null
  status: 'pending' | 'published' | 'rejected' | 'withdrawn'
  published_at: string | null
  review_reason: string | null
  event_id: string | null
  article_id: string | null
  created_at: string
  articles: { slug: string; href: string }[] | null
}

export async function loadAdminFacts(client: SupabaseClient): Promise<AdminFact[]> {
  // Read article links explicitly rather than depending on PostgREST's inferred
  // relationship (which can be ambiguous in installations with extra FKs).
  const { data, error } = await client.from('facts')
    .select('id,content,category,source_name,source_url,article_id,event_id,status,published_at,review_reason,created_at')
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) {
    const migration = missingPublicationColumns(error) ||
      (['42703', 'PGRST204'].includes(error.code) && /review_reason/.test(error.message))
    throw new Error(`Could not load Fact Flow: ${error.message}${migration ? ` Apply Supabase migration ${RESEARCH_MIGRATION}.` : ''}`)
  }
  const facts = data ?? []
  if (!facts.length) return []
  const links = await client.from('fact_article_links').select('fact_id,article_id').in('fact_id', facts.map(f => f.id))
  if (links.error) throw new Error(`Could not load Fact Flow article links: ${links.error.message}`)
  const ids = [...new Set([...facts.map(f => f.article_id), ...(links.data || []).map(l => l.article_id)].filter(Boolean))] as string[]
  const byId = new Map<string, PostReference & { published_at?: string }>()
  if (ids.length) {
    const articles = await client.from('articles').select('id,slug,published_at,article_type,content_type,content_slug').in('id', ids)
    if (articles.error) throw new Error(`Could not load Fact Flow article links: ${articles.error.message}`)
    for (const article of articles.data ?? []) byId.set(article.id, article)
  }
  return facts.map(f => {
    const associated = (links.data || []).filter(l => l.fact_id === f.id).map(l => l.article_id)
      .sort((a,b) => (byId.get(b)?.published_at || '').localeCompare(byId.get(a)?.published_at || ''))
    const articleIds = [...new Set([f.article_id, ...associated].filter(Boolean))]
    const articles = articleIds.flatMap(id => {
      const article = byId.get(id)
      return article ? [{ slug: article.slug, href: articleHref(article) }] : []
    })
    return { ...f, articles: articles.length ? articles : null }
  })
}
