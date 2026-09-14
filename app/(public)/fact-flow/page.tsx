import { createPublicClient } from '@/lib/supabase/server'
import { required } from '@/lib/supabase/required'
import Link from 'next/link'
import type { Metadata } from 'next'
import { ShareButton } from '@/components/ShareButton'

export const revalidate = 3600

export function generateMetadata(): Metadata {
  return {
    title: 'Fact Flow',
    description: 'A real-time stream of verified facts, data points, and key developments from the localization and language technology industry — distilled from primary sources as they are published.',
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

type FactRow = {
  id: string
  content: string
  category: string
  source_url: string | null
  source_name: string | null
  article_id: string | null
  created_at: string
}

function groupByDay(facts: FactRow[]) {
  const map = new Map<string, FactRow[]>()
  for (const f of facts) {
    const key = new Date(f.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(f)
  }
  return Array.from(map.entries()).map(([label, items]) => ({ label, count: items.length, items }))
}

export default async function FactFlowPage() {
  const supabase = createPublicClient()

  const factsResult = await supabase
    .from('facts')
    .select('id, content, category, source_url, source_name, article_id, created_at')
    .not('article_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(120)

  const facts = required(factsResult, 'fact flow')

  // Resolve article slugs for all facts that have an article_id
  const articleIds = [...new Set((facts ?? []).map(f => f.article_id).filter(Boolean))]
  const slugMap = new Map<string, string>()
  if (articleIds.length > 0) {
    const { data: articles } = await supabase
      .from('articles')
      .select('id, slug')
      .in('id', articleIds as string[])
    for (const a of articles ?? []) slugMap.set(a.id, a.slug)
  }

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
            <p className="ff-hero-desc">Verified facts the moment they're confirmed!</p>
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
            <p>Facts will appear here as articles are ingested.</p>
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
                  const slug = fact.article_id ? slugMap.get(fact.article_id) : undefined
                  return (
                    <div key={fact.id} className="ff-bubble">
                      <div className="ff-bubble-body">
                        <span className="ff-bullet" aria-hidden="true" />
                        <div style={{ flex: 1 }}>
                          <time className="ff-time" dateTime={fact.created_at} title={formatDate(fact.created_at)}>
                            {timeAgo(fact.created_at)}
                          </time>
                          {slug ? (
                            <Link href={`/articles/${slug}`} className="ff-content-link">{fact.content}</Link>
                          ) : (
                            <span className="ff-content">{fact.content}</span>
                          )}
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

