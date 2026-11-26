import type { MetadataRoute } from 'next'
import { createPublicClient } from '@/lib/supabase/server'
import { required } from '@/lib/supabase/required'
import { fetchDirectoryEntries } from '@/lib/directory'
import { articleHref, CONTENT_TYPES, CONTENT_TAXONOMY, type PostReference } from '@/lib/contentTaxonomy'
import { noindexArticleIds } from '@/lib/articleIndexing'
import { SITE_URL } from '@/lib/seo'
import { ANNUAL_REPORTS, annualReportPath } from '@/lib/reports'

// Not revalidated on publish: a ~30-unit write per publish bought nothing,
// crawlers re-read sitemaps on their own schedule.
export const revalidate = 21600

// The PostgREST response limit applies even when the archive exceeds 1,000 rows.
const QUERY_LIMIT = 1000

const STATIC_PAGES: MetadataRoute.Sitemap = [
  { url: `${SITE_URL}/` },
  ...CONTENT_TYPES.map(type => ({ url: `${SITE_URL}${CONTENT_TAXONOMY[type].path}` })),
  { url: `${SITE_URL}/fact-flow` },
  ...ANNUAL_REPORTS.map(report => ({ url: `${SITE_URL}${annualReportPath(report.slug)}` })),
  { url: `${SITE_URL}/locstock` },
  { url: `${SITE_URL}/llm-pricing` },
  { url: `${SITE_URL}/directory` },
  { url: `${SITE_URL}/about` },
  { url: `${SITE_URL}/contact` },
  { url: `${SITE_URL}/privacy` },
  { url: `${SITE_URL}/terms` },
]

type Row = PostReference & { id: string; published_at: string; updated_at: string | null }

async function fetchAllArticles(): Promise<Row[]> {
  const supabase = createPublicClient()
  const rows: Row[] = []
  for (let from = 0; ; from += QUERY_LIMIT) {
    const page = required(
      await supabase
        .from('public_article_index')
        .select('id, slug, content_type, content_slug, article_type, published_at, updated_at')
        .order('published_at', { ascending: false })
        .order('id', { ascending: false })
        .range(from, from + QUERY_LIMIT - 1),
      'sitemap articles'
    ) as Row[] | null
    rows.push(...(page ?? []))
    if (!page || page.length < QUERY_LIMIT) return rows
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [articles, directory, excluded] = await Promise.all([
    fetchAllArticles(),
    fetchDirectoryEntries(createPublicClient()),
    noindexArticleIds(createPublicClient()),
  ])
  const urls = new Map(STATIC_PAGES.map(page => [page.url, page]))
  for (const article of articles) {
    if (excluded.has(article.id)) continue
    const url = `${SITE_URL}${articleHref(article)}`
    if (urls.has(url)) continue
    const lastModified = new Date(article.updated_at ?? article.published_at)
    urls.set(url, Number.isFinite(lastModified.getTime()) ? { url, lastModified } : { url })
  }
  // Paginated listing pages (/page/N/) stay crawlable through their links but are
  // not submitted: they hold no content of their own and only dilute the sitemap.
  for (const entry of directory) {
    const url = `${SITE_URL}/directory/${entry.slug}`
    urls.set(url, { url })
  }
  return [...urls.values()]
}
