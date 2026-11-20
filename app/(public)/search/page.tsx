import Link from 'next/link'
import type { Metadata } from 'next'
import { createPublicClient } from '@/lib/supabase/server'
import { articleHref } from '@/lib/utils'
import { monthlyReportTitle, monthlyReportSubtitle, type BriefingCoverage } from '@/lib/briefingDisplay'
import { withOptionalBriefingCoverage } from '@/lib/briefingCoverage'
import { embedText } from '@/lib/embeddings'
import { SearchRefine } from './SearchRefine'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Search',
  robots: {
    index: false,
    follow: true,
  },
}

const STATIC_PAGES = [
  { title: 'Monthly Report', href: '/reports', section: 'Reports', excerpt: 'What mattered in localization and language services, its practical implications and what to watch next.' },
  { title: 'Fact Flow', href: '/fact-flow', section: 'News', excerpt: 'The latest localization and language-services news with links to original sources.' },
  { title: '2026 Global Localization Market Report', href: '/reports/2026-annual-global-market-report', section: 'Report archive', excerpt: 'Archived annual analysis of market evolution, AI disruption, and competitive dynamics.' },
  { title: 'LocStock — Localization Market Index', href: '/locstock', section: 'Tools', excerpt: 'Live equity overview of 39 publicly traded companies in language services and AI translation.' },
  { title: 'Industry Directory', href: '/directory', section: 'Tools', excerpt: 'Directory of companies in language services, translation technology, and localization.' },
]

interface ArticleResult extends BriefingCoverage {
  id: string
  title: string
  slug: string
  excerpt: string | null
  publisher: string | null
  article_type: string | null
  published_at: string
}

type BriefingResult = Pick<ArticleResult, 'id' | 'title' | 'slug' | 'published_at'> & BriefingCoverage

/**
 * Hybrid semantic + keyword search with graceful degradation:
 * 1. Embed the query and run RRF-fused vector + full-text search (RPC)
 * 2. If embedding fails (OpenAI outage), keyword-only full-text RPC
 * 3. If the RPCs don't exist yet (migration not applied), legacy ilike
 */
async function searchArticles(
  supabase: ReturnType<typeof createPublicClient>,
  query: string
): Promise<{ results: ArticleResult[]; mode: 'hybrid' | 'keyword' | 'basic' }> {
  try {
    const embedding = await embedText(query)
    const { data, error } = await supabase.rpc('hybrid_search_articles', {
      query_text: query,
      query_embedding: embedding,
      match_count: 24,
    })
    if (!error && data) {
      return { results: (data as ArticleResult[]).slice(0, 20), mode: 'hybrid' }
    }
  } catch (err) {
    console.error('hybrid search failed, falling back to keyword search', err)
  }

  const { data: keywordData, error: keywordError } = await supabase.rpc('keyword_search_articles', {
    query_text: query,
    match_count: 24,
  })
  if (!keywordError && keywordData) {
    return { results: (keywordData as ArticleResult[]).slice(0, 20), mode: 'keyword' }
  }

  // Legacy path for environments where the search migration hasn't run.
  const sanitized = query.replace(/[,%().]/g, ' ').trim()
  const { data } = await supabase
    .from('articles')
    .select('id, title, slug, excerpt, publisher, article_type, published_at')
    .or(`title.ilike.%${sanitized}%,excerpt.ilike.%${sanitized}%,publisher.ilike.%${sanitized}%`)
    .order('published_at', { ascending: false })
    .limit(20)
  return { results: (data as ArticleResult[]) ?? [], mode: 'basic' }
}

function highlight(text: string, q: string): string {
  if (!q || !text) return text
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return text.replace(new RegExp(`(${escaped})`, 'gi'), '<mark>$1</mark>')
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Warsaw' })
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = '' } = await searchParams
  const query = q.trim()

  const supabase = createPublicClient()

  // Sidebar data — always fetched
  const { data: monthlyReports } = await withOptionalBriefingCoverage(coverageColumns => supabase
    .from('articles')
    .select('id, title, slug, published_at' + coverageColumns)
    .eq('article_type', 'monthly-summary')
    .order('published_at', { ascending: false })
    .limit(1)
    .returns<BriefingResult[]>())

  const latestMonthly = monthlyReports?.[0] ?? null

  if (!query) {
    return (
      <div className="container search-page">
        <div className="search-layout">
          <div className="search-main" style={{ maxWidth: 'none' }}>
            <SearchRefine initialQ="" />
            <h1 className="search-heading">Search</h1>
            <p className="search-subtitle">Search by topic, company, or concept — results are ranked by meaning, not just keyword matches.</p>
          </div>
          <SearchSidebar latestMonthly={latestMonthly} />
        </div>
      </div>
    )
  }

  const qLower = query.toLowerCase()
  const { results: articles, mode } = await searchArticles(supabase, query)
  const reportIds = articles.filter(article => article.article_type === 'monthly-summary').map(article => article.id)
  const { data: reportCoverage } = reportIds.length > 0
    ? await withOptionalBriefingCoverage(columns => supabase
      .from('articles').select('id' + columns).in('id', reportIds)
      .returns<Array<BriefingCoverage & { id: string }>>())
    : { data: [] }
  const coverageById = new Map(reportCoverage?.map(report => [report.id, report]))

  // Static pages
  const pages = STATIC_PAGES.filter(p =>
    p.title.toLowerCase().includes(qLower) ||
    p.excerpt.toLowerCase().includes(qLower)
  )

  const total = articles.length + pages.length

  return (
    <div className="container search-page">
      <div className="search-layout">

        {/* Main results */}
        <div className="search-main">
          <SearchRefine initialQ={query} />
          <h1 className="search-heading search-heading--results">
            Results for <em className="search-heading__query">{query}</em>
          </h1>
          <p className="search-meta">
            {total} result{total !== 1 ? 's' : ''} across all sections
            {mode === 'hybrid' && ' · ranked by relevance'}
          </p>

          {pages.length > 0 && (
            <Section label="Pages" count={pages.length}>
              {pages.map(p => (
                <ResultRow key={p.href} href={p.href} section={p.section}
                  title={<span dangerouslySetInnerHTML={{ __html: highlight(p.title, query) }} />}
                  excerpt={<span dangerouslySetInnerHTML={{ __html: highlight(p.excerpt, query) }} />}
                />
              ))}
            </Section>
          )}

          {articles.length > 0 && (
            <Section label="Articles" count={articles.length}>
              {articles.map(a => {
                const isReport = a.article_type === 'monthly-summary'
                const title = isReport ? monthlyReportTitle({ ...a, ...coverageById.get(a.id) }) : a.title
                const excerpt = isReport ? monthlyReportSubtitle(a.excerpt) : a.excerpt
                return (
                  <ResultRow key={a.id} href={articleHref(a.slug)} section={isReport ? 'Monthly Report' : a.publisher ?? 'Article'}
                    title={<span dangerouslySetInnerHTML={{ __html: highlight(title, query) }} />}
                    excerpt={excerpt ? <span dangerouslySetInnerHTML={{ __html: highlight(excerpt, query) }} /> : null}
                    meta={<span className="search-result__meta-text search-result__meta-text--row">{fmtDate(a.published_at)}</span>}
                  />
                )
              })}
            </Section>
          )}

          {total === 0 && (
            <p className="search-empty">
              No results found. Try a different search term.
            </p>
          )}
        </div>

        <SearchSidebar latestMonthly={latestMonthly} />
      </div>
    </div>
  )
}

function SearchSidebar({ latestMonthly }: {
  latestMonthly: BriefingResult | null
}) {
  return (
    <aside className="post-sidebar search-sidebar">
      {latestMonthly && (
        <div className="post-sidebar-widget">
          <p className="post-sidebar-widget__title">Latest Monthly Report</p>
          <Link href={articleHref(latestMonthly.slug)} className="search-sidebar__link">
            <p className="search-sidebar__link-title">{monthlyReportTitle(latestMonthly)}</p>
            <p className="search-sidebar__link-sub">
              Published {fmtDate(latestMonthly.published_at)}
            </p>
          </Link>
        </div>
      )}

      <div className="post-sidebar-widget">
        <p className="post-sidebar-widget__title">Monthly Report</p>
        <Link href="/reports" className="search-sidebar__link">
          <p className="search-sidebar__link-title">Browse monthly reports</p>
          <p className="search-sidebar__link-sub">The developments that mattered and what to watch next.</p>
        </Link>
      </div>

      <div className="post-sidebar-widget">
        <p className="post-sidebar-widget__title">Fact Flow</p>
        <Link href="/fact-flow" className="search-sidebar__link">
          <p className="search-sidebar__link-title">Follow the latest industry news</p>
          <p className="search-sidebar__link-sub">Reported developments with links to original sources.</p>
        </Link>
      </div>
    </aside>
  )
}

function Section({ label, count, children }: { label: string; count: number; children: React.ReactNode }) {
  return (
    <div className="search-section">
      <div className="search-section__head">
        <span className="search-section__label">{label}</span>
        <span className="search-section__count">{count}</span>
      </div>
      <div className="search-section__body">{children}</div>
    </div>
  )
}

function ResultRow({ href, title, excerpt, meta, section }: {
  href: string
  title: React.ReactNode
  excerpt?: React.ReactNode | null
  meta?: React.ReactNode
  section: string
}) {
  return (
    <Link href={href} className="search-result">
      <div className="search-result__inner">
        <div className="search-result__main">
          <div className="search-result__title">{title}</div>
          {excerpt && <div className="search-result__excerpt">{excerpt}</div>}
          {meta && <div className="search-result__meta">{meta}</div>}
        </div>
        <span className="search-result__section">{section}</span>
      </div>
    </Link>
  )
}
