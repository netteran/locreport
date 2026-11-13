import type { SupabaseClient } from '@supabase/supabase-js'

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
  if (result.error) throw new Error(`Fact Flow: ${result.error.message}`)
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
