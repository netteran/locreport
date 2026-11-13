import { createPublicClient } from '@/lib/supabase/server'
import { loadPublishedFacts, httpUrl, type PublishedFact } from '@/lib/publicFacts'
import { articleHref } from '@/lib/utils'
import Link from 'next/link'
import type { Metadata } from 'next'
import { ShareButton } from '@/components/ShareButton'

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
    <>
      <style>{`
        .ff-page { max-width: var(--content-width); margin: 0 auto; padding: var(--space-6) var(--page-gutter) var(--space-8); }

        .ff-hero { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); margin-bottom: var(--space-5); flex-wrap: wrap; }
        .ff-hero-left { display: flex; align-items: center; gap: var(--space-2); min-width: 0; flex-wrap: nowrap; }
        .ff-hero-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--accent); flex-shrink: 0; animation: ff-pulse 2.4s ease-in-out infinite; }
        @keyframes ff-pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
        .ff-hero h1 { font-family: var(--font-display); font-size: 1.2rem; font-weight: 700; letter-spacing: -.02em; color: var(--text); margin: 0; white-space: nowrap; flex-shrink: 0; }
        .ff-live-badge { font-size: 0.62rem; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: var(--accent); background: var(--accent-soft); padding: 2px 8px; border-radius: 20px; flex-shrink: 0; }
        .ff-hero-sep { width: 1px; height: 1.1em; background: var(--border); flex-shrink: 0; }
        .ff-hero-desc { font-size: 0.82rem; color: var(--muted); margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
        @media (max-width: 640px) {
          .ff-hero-desc, .ff-hero-sep { display: none; }
        }
        .ff-rss-link { display: inline-flex; align-items: center; gap: 5px; font-size: 0.78rem; font-weight: 600; color: var(--text); text-decoration: none; padding: 2px 4px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); transition: all .15s; white-space: nowrap; }
        .ff-rss-link:hover { color: var(--accent); border-color: var(--accent); background: var(--accent-soft); }
        .ff-rss-icon { color: #E8773E; flex-shrink: 0; }

        .ff-day-group { margin-bottom: var(--space-8); }
        .ff-day-header { display: flex; align-items: center; gap: var(--space-3); margin-bottom: var(--space-4); }
        .ff-day-label { font-family: var(--font-display); font-size: 0.78rem; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); white-space: nowrap; }
        .ff-day-line { flex: 1; height: 1px; background: var(--hairline); }
        .ff-day-count { font-size: 0.7rem; font-weight: 600; color: var(--muted); background: var(--bg-secondary); padding: 2px 8px; border-radius: 20px; }

        .ff-stream { display: flex; flex-direction: column; gap: var(--space-2); }

        .ff-bubble { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: var(--space-4) var(--space-5); transition: box-shadow .15s, border-color .15s; }
        .ff-bubble:hover { box-shadow: var(--card-shadow-hover); border-color: rgba(53,80,245,.12); }

        .ff-bubble-body { display: flex; align-items: baseline; gap: var(--space-4); }
        .ff-bullet { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); flex-shrink: 0; margin-top: 7px; opacity: .5; }
        .ff-content { font-size: 0.975rem; line-height: 1.55; color: var(--text); flex: 1; }
        .ff-content-link { font-size: 0.975rem; line-height: 1.55; color: var(--text); flex: 1; text-decoration: none; display: block; }
        .ff-content-link:hover { color: var(--accent); }
        .ff-bubble:has(.ff-content-link) { cursor: pointer; }
        .ff-time { font-size: 0.68rem; color: var(--muted); white-space: nowrap; float: right; margin-left: var(--space-3); line-height: 1.55; }

        .ff-empty { text-align: center; padding: var(--space-16) 0; color: var(--muted); }
        .ff-empty h2 { font-family: var(--font-display); font-size: 1.25rem; color: var(--text); margin-bottom: var(--space-2); }
      `}</style>

      <div className="ff-page">
        <div className="ff-hero">
          <div className="ff-hero-left">
            <span className="ff-hero-dot" aria-hidden="true" />
            <h1>Fact Flow</h1>
            <span className="ff-live-badge">Live</span>
            <span className="ff-hero-sep" aria-hidden="true" />
            <p className="ff-hero-desc">Industry developments, with the sources behind them.</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
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
        </div>

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
                  return (
                    <div key={fact.id} id={fact.id} className="ff-bubble" style={{scrollMarginTop:100}}>
                      <div className="ff-bubble-body">
                        <span className="ff-bullet" aria-hidden="true" />
                        <div style={{ flex: 1 }}>
                          <time className="ff-time" dateTime={fact.published_at} title={formatDate(fact.published_at)}>
                            {timeAgo(fact.published_at)}
                          </time>
                          {sourceUrl ? <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="ff-content-link">{fact.content}</a> : <span className="ff-content">{fact.content}</span>}
                          <div className="flex gap-3 flex-wrap mt-2 text-xs" style={{color:'var(--muted)'}}>
                            {sourceUrl&&<a href={sourceUrl} target="_blank" rel="noopener noreferrer">Source: {fact.source_name||'Original reporting'} ↗</a>}
                            <a href={`#${fact.id}`}>Permalink</a>
                            {fact.analyses.map(a=><Link key={a.id} href={articleHref(a.slug)}>LocReport analysis: {a.title} →</Link>)}
                          </div>
                          {fact.sources.length>1&&<details className="mt-2 text-xs"><summary className="cursor-pointer">{fact.sources.length} supporting sources</summary><ul className="mt-2 space-y-1">{fact.sources.map(source=><li key={source.source_url}><a href={httpUrl(source.source_url)||'#'} target="_blank" rel="noopener noreferrer">{source.source_name||source.title} ↗</a></li>)}</ul></details>}

                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </>
  )
}

