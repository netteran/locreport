import Link from 'next/link'
import type { Metadata } from 'next'
import { createPublicClient } from '@/lib/supabase/server'
import { SIGNALS } from '@/lib/signals'
import { articleHref } from '@/lib/utils'
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
  { title: '2026 Annual Global Market Report', href: '/reports/2026-annual-global-market-report', section: 'Reports', excerpt: 'Data-rich strategic brief covering market evolution, AI disruption, and competitive dynamics.' },
  { title: 'LocStock — Localization Market Index', href: '/compass/locstock', section: 'Compass', excerpt: 'Live equity overview of 38 publicly traded companies in language services and AI translation.' },
  { title: 'Compass — Industry Tools', href: '/compass', section: 'Compass', excerpt: 'Market intelligence tools: LocStock, industry directory, events, LLM pricing tracker.' },
  { title: 'Intelligence Overview', href: '/intelligence', section: 'Intelligence', excerpt: 'High-impact signals, trends and analysis for the localization industry.' },
  { title: 'Industry Directory', href: '/compass/directory', section: 'Compass', excerpt: 'Directory of companies in language services, translation technology, and localization.' },
  { title: 'LLM Pricing Tracker', href: '/compass/llm-pricing', section: 'Compass', excerpt: 'Comparative pricing for large language models used in translation and localization.' },
  { title: 'Events', href: '/compass/events', section: 'Compass', excerpt: 'Upcoming and recent industry events in localization and language technology.' },
]

interface ArticleResult {
  id: string
  title: string
  slug: string
  excerpt: string | null
  publisher: string | null
  article_type: string | null
  published_at: string
  impact_score: number | null
}

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
      return { results: (data as ArticleResult[]).filter(a => a.article_type !== 'monthly-summary').slice(0, 20), mode: 'hybrid' }
    }
  } catch (err) {
    console.error('hybrid search failed, falling back to keyword search', err)
  }

  const { data: keywordData, error: keywordError } = await supabase.rpc('keyword_search_articles', {
    query_text: query,
    match_count: 24,
  })
  if (!keywordError && keywordData) {
    return { results: (keywordData as ArticleResult[]).filter(a => a.article_type !== 'monthly-summary').slice(0, 20), mode: 'keyword' }
  }

  // Legacy path for environments where the search migration hasn't run.
  const sanitized = query.replace(/[,%().]/g, ' ').trim()
  const { data } = await supabase
    .from('articles')
    .select('id, title, slug, excerpt, publisher, article_type, published_at, impact_score')
    .neq('article_type', 'monthly-summary')
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

const IMPACT_LABEL: Record<number, string> = { 2: 'Notable', 3: 'Significant', 4: 'Major', 5: 'Disruptive' }

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = '' } = await searchParams
  const query = q.trim()

  const supabase = createPublicClient()

  // Sidebar data — always fetched
  const { data: monthlyReports } = await supabase
    .from('articles')
    .select('id, title, slug, published_at')
    .eq('article_type', 'monthly-summary')
    .order('published_at', { ascending: false })
    .limit(1)

  const latestMonthly = monthlyReports?.[0] ?? null
  const activeSignals = SIGNALS.filter(s => s.current_status === 'supported' || s.current_status === 'emerging').slice(0, 6)

  if (!query) {
    return (
      <div className="container search-page">
        <div className="search-layout">
          <div className="search-main" style={{ maxWidth: 'none' }}>
            <SearchRefine initialQ="" />
            <h1 className="search-heading">Search</h1>
            <p className="search-subtitle">Search by topic, company, or concept — results are ranked by meaning, not just keyword matches.</p>
          </div>
          <SearchSidebar latestMonthly={latestMonthly} activeSignals={activeSignals} />
        </div>
      </div>
    )
  }

  const qLower = query.toLowerCase()
  const { results: articles, mode } = await searchArticles(supabase, query)

  // Signals (static)
  const signals = SIGNALS.filter(s =>
    s.title.toLowerCase().includes(qLower) ||
    s.description.toLowerCase().includes(qLower) ||
    s.keywords.some(k => k.toLowerCase().includes(qLower))
  )

  // Static pages
  const pages = STATIC_PAGES.filter(p =>
    p.title.toLowerCase().includes(qLower) ||
    p.excerpt.toLowerCase().includes(qLower)
  )

  const total = articles.length + signals.length + pages.length

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

          {signals.length > 0 && (
            <Section label="Signals" count={signals.length}>
              {signals.map(s => (
                <ResultRow key={s.id} href={`/intelligence/signals/${s.id}`} section="Intelligence"
                  title={<span dangerouslySetInnerHTML={{ __html: highlight(s.title, query) }} />}
                  excerpt={<span dangerouslySetInnerHTML={{ __html: highlight(s.description, query) }} />}
                  meta={<span className="search-result__meta-text">{s.current_status} · {s.category}</span>}
                />
              ))}
            </Section>
          )}

          {articles.length > 0 && (
            <Section label="Articles" count={articles.length}>
              {articles.map(a => (
                <ResultRow key={a.id} href={articleHref(a.slug)} section={a.publisher ?? 'Article'}
                  title={<span dangerouslySetInnerHTML={{ __html: highlight(a.title, query) }} />}
                  excerpt={a.excerpt ? <span dangerouslySetInnerHTML={{ __html: highlight(a.excerpt, query) }} /> : null}
                  meta={
                    <span className="search-result__meta-text search-result__meta-text--row">
                      {fmtDate(a.published_at)}
                      {a.impact_score && a.impact_score >= 2 && (
                        <span className={`search-result__impact search-result__impact--${a.impact_score}`}>
                          {IMPACT_LABEL[a.impact_score]}
                        </span>
                      )}
                    </span>
                  }
                />
              ))}
            </Section>
          )}

          {total === 0 && (
            <p className="search-empty">
              No results found. Try a different search term.
            </p>
          )}
        </div>

        <SearchSidebar latestMonthly={latestMonthly} activeSignals={activeSignals} />
      </div>
    </div>
  )
}

function SearchSidebar({ latestMonthly, activeSignals }: {
  latestMonthly: { title: string; slug: string; published_at: string } | null
  activeSignals: typeof SIGNALS
}) {
  return (
    <aside className="post-sidebar search-sidebar">
      {latestMonthly && (
        <div className="post-sidebar-widget">
          <p className="post-sidebar-widget__title">Latest Monthly Report</p>
          <Link href={articleHref(latestMonthly.slug)} className="search-sidebar__link">
            <p className="search-sidebar__link-title">{latestMonthly.title}</p>
            <p className="search-sidebar__link-sub">
              {new Date(latestMonthly.published_at).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
            </p>
          </Link>
        </div>
      )}

      <div className="post-sidebar-widget">
        <p className="post-sidebar-widget__title">Annual Report</p>
        <Link href="/reports/2026-annual-global-market-report" className="search-sidebar__link">
          <p className="search-sidebar__link-title">2026 Annual Global Market Report</p>
          <p className="search-sidebar__link-sub">Localization &amp; Translation Industry</p>
        </Link>
      </div>

      <div className="post-sidebar-widget">
        <p className="post-sidebar-widget__title">Active Signals</p>
        <ul className="search-sidebar__list">
          {activeSignals.map(s => (
            <li key={s.id}>
              <Link href={`/intelligence/signals/${s.id}`} className="search-sidebar__signal">
                {s.title}
              </Link>
              <span className="search-sidebar__signal-status">{s.current_status}</span>
            </li>
          ))}
        </ul>
        <Link href="/intelligence/signals" className="search-sidebar__more">
          All signals →
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
