import type { SupabaseClient } from '@supabase/supabase-js'
import { articleHref, type PostReference } from '@/lib/contentTaxonomy'
import { missingPublicationColumns } from '@/lib/researchSchema'

export interface PublishedFact {
  id: string
  content: string
  category: string
  source_url: string | null
  source_name: string | null
  article_id: string | null
  event_id: string | null
  created_at: string
  published_at: string
  sources: { source_url: string; source_name: string | null; title: string }[]
  analyses: (PostReference & { id: string; title: string })[]
}
export function factPermalink(id: string) {
  return `https://locreport.com/fact-flow#${id}`
}
export function httpUrl(value: string | null | undefined) {
  if (!value) return null
  try {
    const u = new URL(value)
    return ['https:', 'http:'].includes(u.protocol) ? u.toString() : null
  } catch {
    return null
  }
}

/**
 * The fact sentence links only to LocReport's own coverage. It is the most descriptive anchor on
 * the page, so it should pass relevance to our article rather than to an external site. A fact with
 * no published article renders as plain text; the original publisher is credited by the separate
 * "Source" link (see sourceLinkRel).
 */
export function factMainLink(fact: Pick<PublishedFact, 'analyses'>): string | null {
  const analysis = fact.analyses.find(a => a?.slug)
  return analysis ? articleHref(analysis) : null
}

/** Coverage beyond the article the fact text already links to, so the same URL isn't linked twice. */
export function additionalAnalyses<T extends { slug?: string | null }>(fact: { analyses: T[] }): T[] {
  const main = fact.analyses.find(a => a?.slug)
  return fact.analyses.filter(a => a !== main)
}

/**
 * rel for an outbound source link. Citations stay followed (crediting primary sources is a trust
 * signal) and keep the referrer so publishers can see LocReport traffic. Google News items are
 * stored as news.google.com redirect URLs (ingest's dedupe key), which are not a citation of the
 * real publisher, so those are nofollow.
 */
export function sourceLinkRel(url: string): string {
  try {
    if (new URL(url).hostname === 'news.google.com') return 'noopener nofollow'
  } catch {}
  return 'noopener'
}

export async function loadPublishedFacts(
  client: SupabaseClient,
  limit = 120
): Promise<PublishedFact[]> {
  const result = await client
    .from('facts')
    .select(
      'id,content,category,source_url,source_name,article_id,event_id,created_at,published_at'
    )
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .limit(limit)
  if (result.error) {
    if (missingPublicationColumns(result.error)) return loadLegacyPublishedFacts(client, limit)
    throw new Error(`Fact Flow: ${result.error.message}`)
  }
  if (!result.data?.length) return []
  const ids = result.data.map((f) => f.id)
  const [sources, links] = await Promise.all([
    client
      .from('public_fact_sources')
      .select('fact_id,source_url,source_name,title')
      .in('fact_id', ids),
    client.from('fact_article_links').select('fact_id,articles(id,slug,title,published_at,article_type,content_type,content_slug)').in('fact_id', ids)
  ])
  if (sources.error || links.error) throw new Error(sources.error?.message || links.error?.message)
  // Manual and older facts may have a direct article_id without an association row.
  const linkedIds = new Set((links.data || []).flatMap(l => l.articles ? (Array.isArray(l.articles) ? l.articles : [l.articles]) : []).map(a => a.id))
  const missingIds = [...new Set(result.data.map(f => f.article_id).filter(id => id && !linkedIds.has(id)))] as string[]
  const direct = missingIds.length ? await client.from('articles').select('id,slug,title,published_at,article_type,content_type,content_slug').in('id', missingIds) : { data: [], error: null }
  if (direct.error) throw new Error(`Fact Flow article links: ${direct.error.message}`)
  const articleMap = new Map([...(links.data || []).flatMap(l => l.articles ? (Array.isArray(l.articles) ? l.articles : [l.articles]) : []), ...(direct.data || [])].map(a => [a.id, a]))
  return result.data.map(f => {
    const related = (links.data || []).filter(l => l.fact_id === f.id).flatMap(l => l.articles ? (Array.isArray(l.articles) ? l.articles : [l.articles]) : [])
    if (f.article_id && articleMap.has(f.article_id)) related.push(articleMap.get(f.article_id)!)
    const analyses = [...new Map(related.filter(a => a?.slug).map(a => [a.id,a])).values()]
      .sort((a,b) => (b.published_at || '').localeCompare(a.published_at || '') || a.id.localeCompare(b.id))
    return { ...f, sources: (sources.data || []).filter(s => s.fact_id === f.id), analyses }
  })
}

/** The old schema publishes facts only when article_id is set. Never expose parked facts. */
async function loadLegacyPublishedFacts(
  client: SupabaseClient,
  limit: number
): Promise<PublishedFact[]> {
  const { data, error } = await client
    .from('facts')
    .select('id,content,category,source_url,source_name,article_id,created_at')
    .not('article_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(`Fact Flow (legacy): ${error.message}`)
  if (!data?.length) return []
  const articleIds = [...new Set(data.map((f) => f.article_id).filter(Boolean))] as string[]
  const articles = await client.from('articles').select('id,slug,title,article_type,content_type,content_slug').in('id', articleIds)
  if (articles.error) throw new Error(`Fact Flow article links: ${articles.error.message}`)
  const articleMap = new Map((articles.data || []).map((a) => [a.id, a]))
  return data.map((f) => ({
    ...f,
    event_id: null,
    published_at: f.created_at,
    sources: f.source_url
      ? [
          {
            source_url: f.source_url,
            source_name: f.source_name,
            title: f.source_name || 'Original reporting'
          }
        ]
      : [],
    analyses: articleMap.has(f.article_id) ? [articleMap.get(f.article_id)!] : []
  }))
}
