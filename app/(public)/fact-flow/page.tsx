import { createPublicClient } from '@/lib/supabase/server'
import { loadPublishedFacts, httpUrl, factMainLink, type PublishedFact } from '@/lib/publicFacts'
import { articleHref } from '@/lib/utils'
import Link from 'next/link'
import type { Metadata } from 'next'
import { ShareButton } from '@/components/ShareButton'
import './fact-flow.css'

export const revalidate = 3600

export function generateMetadata(): Metadata {
  return {
    title: 'Fact Flow',
    description: 'A real-time stream of sourced facts, data points, and key developments from the localization and language technology industry — drawn from industry sources and reviewed or published from selected trusted sources.',
    openGraph: {
      title: { absolute: 'Fact Flow by LocReport' },
      description: "What's happening in localization and language tech right now — bare facts, no editorial delay. Updated daily from primary industry sources.",
      url: 'https://locreport.com/fact-flow',
      type: 'website',
      images: [{ url: 'https://locreport.com/og-factflow.png', width: 1200, height: 630, alt: 'Fact Flow — LocReport' }],
    },
    twitter: {
      card: 'summary_large_image',
      title: { absolute: 'Fact Flow by LocReport' },
      description: "What's happening in localization and language tech right now — bare facts, no editorial delay.",
      images: ['https://locreport.com/og-factflow.png'],
    },
    alternates: {
      canonical: '/fact-flow',
      types: {
        'application/rss+xml': 'https://locreport.com/fact-flow/feed.xml',
      },
    },
  }
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

type FactRow = PublishedFact

function groupByDay(facts: FactRow[]) {
  const map = new Map<string, FactRow[]>()
  for (const f of facts) {
    const key = new Date(f.published_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(f)
  }
  return Array.from(map.entries()).map(([label, items]) => ({ label, count: items.length, items }))
}

export default async function FactFlowPage() {
  const supabase = createPublicClient()

  const facts = await loadPublishedFacts(supabase)

  const grouped = groupByDay(facts ?? [])

  return (
    <main className="ff-page public-page container">
      <header className="ff-hero public-page-heading">
        <div>
          <div className="ff-hero-title">
            <h1>Fact Flow</h1>
            <span className="ff-live-badge">Live</span>
          </div>
          <p>Industry developments, with the sources behind them.</p>
        </div>
        <div className="ff-hero-actions">
          <a href="/fact-flow/feed.xml" className="ff-rss-link">
            <svg className="ff-rss-icon" xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <circle cx="6.18" cy="17.82" r="2.18"/>
              <path d="M4 11.64A8.36 8.36 0 0 1 12.36 20"/>
              <path d="M4 6a14 14 0 0 1 14 14"/>
            </svg>
            RSS Feed
          </a>
          <ShareButton title="Fact Flow — LocReport" url="https://locreport.com/fact-flow" />
        </div>
      </header>

      {grouped.length === 0 ? (
        <div className="ff-empty">
          <h2>No facts yet</h2>
          <p>Published industry news will appear here.</p>
        </div>
      ) : (
        grouped.map(({ label, count, items }) => (
          <div key={label} className="ff-day-group">
            <div className="ff-day-header">
              <span className="ff-day-label">{label}</span>
              <span className="ff-day-line" />
              <span className="ff-day-count">{count} facts</span>
            </div>
            <div className="ff-stream">
              {items.map(fact => {
                const sourceUrl = httpUrl(fact.source_url)
                const main = factMainLink(fact)
                return (
                  <article key={fact.id} id={fact.id} className="ff-bubble">
                    <time className="ff-time" dateTime={fact.published_at} title={formatDate(fact.published_at)}>
                      {timeAgo(fact.published_at)}
                    </time>
                    {main ? main.external ? (
                      <a href={main.href} target="_blank" rel="noopener noreferrer" className="ff-content-link">{fact.content}</a>
                    ) : (
                      <Link href={main.href} className="ff-content-link">{fact.content}</Link>
                    ) : <span className="ff-content">{fact.content}</span>}
                    <div className="ff-entry-links">
                      {sourceUrl && (
                        <a href={sourceUrl} target="_blank" rel="noopener noreferrer">Source: {fact.source_name || 'Original reporting'} ↗</a>
                      )}
                      <a href={`#${fact.id}`}>Permalink</a>
                      {fact.analyses.map(analysis => (
                        <Link key={analysis.id} href={articleHref(analysis.slug)}>LocReport analysis: {analysis.title} →</Link>
                      ))}
                    </div>
                    {fact.sources.length > 1 && (
                      <details className="mt-2 text-xs">
                        <summary className="cursor-pointer">{fact.sources.length} supporting sources</summary>
                        <ul className="mt-2 space-y-1">
                          {fact.sources.map(source => (
                            <li key={source.source_url}>
                              <a href={httpUrl(source.source_url) || '#'} target="_blank" rel="noopener noreferrer">{source.source_name || source.title} ↗</a>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </article>
                )
              })}
            </div>
          </div>
        ))
      )}
    </main>
  )
}

