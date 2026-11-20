import { MetadataRoute } from 'next'
import { createPublicClient } from '@/lib/supabase/server'
import { required } from '@/lib/supabase/required'
import { fetchDirectoryEntries } from '@/lib/directory'
import { articleHref } from '@/lib/utils'
import { SITE_URL } from '@/lib/seo'
import { ANNUAL_REPORTS, annualReportPath } from '@/lib/reports'
import { redirects } from '@/vercel.json'

// Cookie-free client keeps this cacheable; an hour matches the listing pages.
export const revalidate = 3600

// PostgREST caps a response at 1,000 rows, so a single select silently dropped
// the oldest articles once the archive grew past that.
const PAGE_SIZE = 1000
const REDIRECT_SOURCES = new Set(redirects.map(rule => rule.source))

const STATIC_PAGES: MetadataRoute.Sitemap = [
  { url: SITE_URL },
  { url: `${SITE_URL}/articles` },
  { url: `${SITE_URL}/fact-flow` },
  { url: `${SITE_URL}/reports` },
  ...ANNUAL_REPORTS.map(report => ({ url: `${SITE_URL}${annualReportPath(report.slug)}` })),
  { url: `${SITE_URL}/locstock` },
  { url: `${SITE_URL}/llm-pricing` },
  { url: `${SITE_URL}/directory` },
  { url: `${SITE_URL}/about` },
  { url: `${SITE_URL}/contact` },
  { url: `${SITE_URL}/privacy` },
  { url: `${SITE_URL}/terms` },
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
        .order('published_at', { ascending: true })
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

  // Match the detail route: a bare slug wins over a dated slug, otherwise
  // the earliest dated copy supplies the content and its modification time.
  const canonicalArticles = new Map<string, Row>()
  for (const article of articles) {
    const path = articleHref(article.slug)
    if (REDIRECT_SOURCES.has(path)) continue
    const url = `${SITE_URL}${path}`
    if (!canonicalArticles.has(url) || !article.slug.includes('/')) {
      canonicalArticles.set(url, article)
    }
  }

  const articleUrls: MetadataRoute.Sitemap = [...canonicalArticles].map(([url, article]) => {
    const lastModified = new Date(article.updated_at ?? article.published_at)
    return Number.isFinite(lastModified.getTime()) ? { url, lastModified } : { url }
  })

  const directoryUrls: MetadataRoute.Sitemap = directory.map((e) => ({
    url: `${SITE_URL}/directory/${e.slug}`,
  }))

  return [...STATIC_PAGES, ...directoryUrls, ...articleUrls]
}
