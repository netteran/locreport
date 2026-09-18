import { MetadataRoute } from 'next'
import { createClient } from '@/lib/supabase/server'

const BASE_URL = 'https://locreport.com'

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

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const supabase = await createClient()

  const { data: articles } = await supabase
    .from('articles')
    .select('slug, published_at, updated_at')
    .order('published_at', { ascending: false })

  const articleUrls: MetadataRoute.Sitemap = (articles ?? []).map((a) => ({
    url: `${BASE_URL}/articles/${a.slug}`,
    lastModified: new Date(a.updated_at ?? a.published_at),
    changeFrequency: 'weekly',
    priority: 0.8,
  }))

  return [...STATIC_PAGES, ...articleUrls]
}
