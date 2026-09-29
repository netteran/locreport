import { MetadataRoute } from 'next'
import { createPublicClient } from '@/lib/supabase/server'
import { required } from '@/lib/supabase/required'
import { fetchDirectoryEntries } from '@/lib/directory'
import { SIGNALS } from '@/lib/signals'
import { articleHref } from '@/lib/utils'

const BASE_URL = 'https://locreport.com'

// Cookie-free client keeps this cacheable; an hour matches the listing pages.
export const revalidate = 3600

// PostgREST caps a response at 1,000 rows, so a single select silently dropped
// the oldest articles once the archive grew past that.
const PAGE_SIZE = 1000

const STATIC_PAGES: MetadataRoute.Sitemap = [
  { url: BASE_URL, changeFrequency: 'daily', priority: 1.0 },
  { url: `${BASE_URL}/articles`, changeFrequency: 'daily', priority: 0.9 },
  { url: `${BASE_URL}/fact-flow`, changeFrequency: 'daily', priority: 0.8 },
  { url: `${BASE_URL}/intelligence`, changeFrequency: 'daily', priority: 0.8 },
  { url: `${BASE_URL}/intelligence/signals`, changeFrequency: 'weekly', priority: 0.7 },
  { url: `${BASE_URL}/intelligence/high-impact`, changeFrequency: 'daily', priority: 0.7 },
  { url: `${BASE_URL}/reports`, changeFrequency: 'monthly', priority: 0.7 },
  { url: `${BASE_URL}/reports/2026-annual-global-market-report`, changeFrequency: 'yearly', priority: 0.6 },
  { url: `${BASE_URL}/reports/monthly`, changeFrequency: 'monthly', priority: 0.6 },
  { url: `${BASE_URL}/compass`, changeFrequency: 'weekly', priority: 0.7 },
  { url: `${BASE_URL}/compass/locstock`, changeFrequency: 'daily', priority: 0.6 },
  { url: `${BASE_URL}/compass/llm-pricing`, changeFrequency: 'weekly', priority: 0.6 },
  { url: `${BASE_URL}/compass/directory`, changeFrequency: 'monthly', priority: 0.6 },
  { url: `${BASE_URL}/about`, changeFrequency: 'yearly', priority: 0.4 },
  { url: `${BASE_URL}/contact`, changeFrequency: 'yearly', priority: 0.3 },
]

type Row = { slug: string; published_at: string; updated_at: string | null }

async function fetchAllArticles(): Promise<Row[]> {
  const supabase = createPublicClient()
  const rows: Row[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    // Primary content: throw rather than publish a sitemap missing every article.
    const page = required(
      await supabase
        .from('articles')
        .select('slug, published_at, updated_at')
        .order('published_at', { ascending: false })
        .order('id', { ascending: true })
        .range(from, from + PAGE_SIZE - 1),
      'sitemap articles'
    ) as Row[] | null
    rows.push(...(page ?? []))
    if (!page || page.length < PAGE_SIZE) return rows
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [articles, directory] = await Promise.all([
    fetchAllArticles(),
    fetchDirectoryEntries(createPublicClient()),
  ])

  // List the canonical URL, never the legacy date path: those 301 to the clean
  // one, and a sitemap full of redirects contradicts each page's canonical tag.
  // Newest first, so a clean URL shared by duplicate imports keeps its latest date.
  const seen = new Set<string>()
  const articleUrls: MetadataRoute.Sitemap = []
  for (const a of articles) {
    const url = `${BASE_URL}${articleHref(a.slug)}`
    if (seen.has(url)) continue
    seen.add(url)
    articleUrls.push({
      url,
      lastModified: new Date(a.updated_at ?? a.published_at),
      changeFrequency: 'weekly',
      priority: 0.8,
    })
  }

  const signalUrls: MetadataRoute.Sitemap = SIGNALS.map((s) => ({
    url: `${BASE_URL}/intelligence/signals/${s.id}`,
    changeFrequency: 'weekly',
    priority: 0.6,
  }))

  const directoryUrls: MetadataRoute.Sitemap = directory.map((e) => ({
    url: `${BASE_URL}/compass/directory/${e.slug}`,
    changeFrequency: 'monthly',
    priority: 0.5,
  }))

  return [...STATIC_PAGES, ...signalUrls, ...directoryUrls, ...articleUrls]
}
