import Link from 'next/link'
import { createPublicClient } from '@/lib/supabase/server'
import { Article } from '@/lib/types'
import type { Metadata } from 'next'
import { Suspense } from 'react'
import { articleHref, safeImageUrl } from '@/lib/utils'
import { getTopics, topicOrFilter, TOPIC_IDS } from '@/lib/topics'
import ArticlesFilter, { FilterState } from './ArticlesFilter'

export const metadata: Metadata = {
  title: 'All Articles',
  description: 'Browse all localization industry articles by topic — quality, operations, governance, market dynamics, and strategy.',
  alternates: { canonical: '/articles' },
}

const PAGE_SIZE = 30

const CATEGORY_LABEL: Record<string, string> = {
  industry: 'Current news',
  'monthly-summary': 'Monthly report',
  annual: 'Annual report',
}

const IMPACT_LABEL: Record<number, string> = { 2: 'Notable', 3: 'Significant', 4: 'Major', 5: 'Disruptive' }

interface FeedRow {
  id: string
  title: string
  href: string
  excerpt: string | null
  author: string | null
  article_type: string
  impact_score: number | null
  published_at: string
  topics: string[]
  image_url: string | null
}

const STATIC_REPORTS: FeedRow[] = [
  {
    id: 'static-annual-2026',
    title: 'Localization & Translation Industry: 2026 Annual Report',
    href: '/reports/2026-annual-global-market-report',
    excerpt: 'A data-rich strategic brief covering market evolution, AI disruption, competitive dynamics, and forward-looking implications for language services stakeholders.',
    author: 'LocReport Editorial Desk',
    article_type: 'annual',
    impact_score: null,
    published_at: '2026-04-01T00:00:00.000Z',
    topics: [],
    image_url: null,
  },
]

type Search = { page?: string; topic?: string; impact?: string; category?: string; from?: string; to?: string; sort?: string }

function parseFilters(sp: Search): FilterState & { page: number } {
  return {
    page: Math.max(1, parseInt(sp.page ?? '1', 10) || 1),
    topic: TOPIC_IDS.includes(sp.topic ?? '') ? sp.topic! : 'all',
    impact: ['2', '3', '4'].includes(sp.impact ?? '') ? sp.impact! : 'all',
    category: ['industry', 'monthly-summary', 'annual'].includes(sp.category ?? '') ? sp.category! : 'all',
    from: /^\d{4}-\d{2}-\d{2}$/.test(sp.from ?? '') ? sp.from! : '',
    to: /^\d{4}-\d{2}-\d{2}$/.test(sp.to ?? '') ? sp.to! : '',
    sort: ['oldest', 'impact'].includes(sp.sort ?? '') ? sp.sort! : 'date',
  }
}

function staticReportMatches(r: FeedRow, f: FilterState): boolean {
  if (f.topic !== 'all' && !r.topics.includes(f.topic)) return false
  if (f.impact !== 'all' && (r.impact_score ?? 0) < parseInt(f.impact, 10)) return false
  if (f.category !== 'all' && r.article_type !== f.category) return false
  const day = r.published_at.slice(0, 10)
  if (f.from && day < f.from) return false
  if (f.to && day > f.to) return false
  return true
}

function pageLink(f: FilterState, page: number): string {
  const params = new URLSearchParams()
  if (f.topic !== 'all') params.set('topic', f.topic)
  if (f.impact !== 'all') params.set('impact', f.impact)
  if (f.category !== 'all') params.set('category', f.category)
  if (f.from) params.set('from', f.from)
  if (f.to) params.set('to', f.to)
  if (f.sort !== 'date') params.set('sort', f.sort)
  if (page > 1) params.set('page', String(page))
  const qs = params.toString()
  return qs ? `/articles?${qs}` : '/articles'
}

export default async function ArticlesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const f = parseFilters(await searchParams)
  const supabase = createPublicClient()

  let query = supabase
    .from('articles')
    .select('id, title, slug, excerpt, author, article_type, impact_score, signal_ids, published_at, image_url', { count: 'exact' })

  if (f.impact !== 'all') query = query.gte('impact_score', parseInt(f.impact, 10))
  if (f.category !== 'all') query = query.eq('article_type', f.category)
  if (f.from) query = query.gte('published_at', `${f.from}T00:00:00Z`)
  if (f.to) query = query.lte('published_at', `${f.to}T23:59:59Z`)
  if (f.topic !== 'all') query = query.or(topicOrFilter(f.topic))

  if (f.sort === 'impact') {
    query = query
      .order('impact_score', { ascending: false, nullsFirst: false })
      .order('published_at', { ascending: false })
  } else {
    query = query.order('published_at', { ascending: f.sort === 'oldest' })
  }

  const fromIdx = (f.page - 1) * PAGE_SIZE
  const [listing, { count: totalCount }] = await Promise.all([
    query.range(fromIdx, fromIdx + PAGE_SIZE - 1),
    supabase.from('articles').select('id', { count: 'exact', head: true }),
  ])

  // A failed query would otherwise fall through to `?? []` and render an
  // article index with no articles, at HTTP 200 — indistinguishable from
  // "nothing matched these filters" to a reader and to any monitoring.
  if (listing.error) {
    throw new Error(`articles listing query failed: ${listing.error.message}`)
  }
  const { data, count } = listing

  let rows: FeedRow[] = ((data as Article[]) ?? []).map(a => ({
    id: a.id,
    title: a.title,
    href: articleHref(a.slug),
    excerpt: a.excerpt ?? null,
    author: a.author ?? null,
    article_type: a.article_type ?? 'industry',
    impact_score: a.impact_score,
    published_at: a.published_at,
    topics: getTopics(a),
    image_url: safeImageUrl(a.image_url),
  }))

  const staticMatches = STATIC_REPORTS.filter(r => staticReportMatches(r, f))
  if (f.page === 1 && staticMatches.length > 0) {
    rows = [...staticMatches, ...rows]
    if (f.sort === 'impact') {
      rows.sort((a, b) => (b.impact_score ?? 0) - (a.impact_score ?? 0) || +new Date(b.published_at) - +new Date(a.published_at))
    } else {
      rows.sort((a, b) => f.sort === 'oldest'
        ? +new Date(a.published_at) - +new Date(b.published_at)
        : +new Date(b.published_at) - +new Date(a.published_at))
    }
  }

  const filteredCount = (count ?? 0) + staticMatches.length
  const archiveTotal = (totalCount ?? 0) + STATIC_REPORTS.length
  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE))

  return (
    <div className="container" style={{ paddingBottom: 'var(--space-12)' }}>
      <section className="all-articles-hero">
        <h1>All articles</h1>
        <p className="all-articles-subtitle">{archiveTotal} articles across the localization intelligence archive.</p>
      </section>

      <Suspense>
        <ArticlesFilter filters={f} shownCount={filteredCount} totalCount={archiveTotal} />
      </Suspense>

      <section className="all-articles-feed-section">
        <div className="all-articles-feed">
          {rows.length === 0 && (
            <p className="filter-count" style={{ padding: 'var(--space-6) 0' }}>
              No articles match these filters.
            </p>
          )}
          {rows.map(article => {
            const dateDisplay = new Date(article.published_at).toLocaleDateString('en-US', {
              month: 'short', day: 'numeric', year: 'numeric',
            })
            return (
              <Link key={article.id} href={article.href} className="article-card">
                {article.image_url && (
                  /* Decorative in this context — the card title is the link text. */
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img className="article-card-thumb" src={article.image_url} alt="" loading="lazy" decoding="async" />
                )}
                <div className="article-card-body">
                  <h3 className="article-card-title">{article.title}</h3>
                  {article.excerpt && (
                    <p className="article-card-excerpt">
                      {article.excerpt.length > 160 ? article.excerpt.slice(0, 160) + '…' : article.excerpt}
                    </p>
                  )}
                  {article.topics.length > 0 && (
                    <div className="article-card-tags">
                      {article.topics.map(t => (
                        <span key={t} className={`article-tag article-tag--${t}`}>{t}</span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="article-card-meta">
                  <time className="article-card-date">{dateDisplay}</time>
                  {article.impact_score && article.impact_score >= 2 && (
                    <span className={`article-card-impact article-card-impact--${article.impact_score}`}>
                      {IMPACT_LABEL[article.impact_score]}
                    </span>
                  )}
                  {article.author && (
                    <span className="article-card-source">{article.author}</span>
                  )}
                  {CATEGORY_LABEL[article.article_type] && (
                    <span className="article-card-category">{CATEGORY_LABEL[article.article_type]}</span>
                  )}
                </div>
              </Link>
            )
          })}
        </div>

        {totalPages > 1 && (
          <nav className="feed-pagination" aria-label="Articles pagination">
            {f.page > 1 ? (
              <Link href={pageLink(f, f.page - 1)} className="feed-pagination__link" rel="prev">← Newer</Link>
            ) : (
              <span className="feed-pagination__link is-disabled">← Newer</span>
            )}
            <span className="feed-pagination__status">Page {f.page} of {totalPages}</span>
            {f.page < totalPages ? (
              <Link href={pageLink(f, f.page + 1)} className="feed-pagination__link" rel="next">Older →</Link>
            ) : (
              <span className="feed-pagination__link is-disabled">Older →</span>
            )}
          </nav>
        )}
      </section>
    </div>
  )
}
