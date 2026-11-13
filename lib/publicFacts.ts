import type { SupabaseClient } from '@supabase/supabase-js'
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
  analyses: { id: string; slug: string; title: string }[]
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
    client.from('fact_article_links').select('fact_id,articles(id,slug,title)').in('fact_id', ids)
  ])
  if (sources.error || links.error) throw new Error(sources.error?.message || links.error?.message)
  return result.data.map((f) => ({
    ...f,
    sources: (sources.data || []).filter((s) => s.fact_id === f.id),
    analyses: (links.data || [])
      .filter((l) => l.fact_id === f.id)
      .flatMap((l) => l.articles as unknown as { id: string; slug: string; title: string }[])
  }))
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
  const articles = await client.from('articles').select('id,slug,title').in('id', articleIds)
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
