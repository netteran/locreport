import type { Metadata } from 'next'
import Link from 'next/link'
import { createPublicClient } from '@/lib/supabase/server'
import { required } from '@/lib/supabase/required'
import { articleHref } from '@/lib/utils'

export const metadata: Metadata = {
  title: 'Monthly Reports',
  description: 'Monthly localization industry reports — curated summaries of translation, AI, and language technology trends.',
  alternates: { canonical: '/reports/monthly' },
}

export const revalidate = 3600

function getTopicChips(title: string, excerpt: string): string[] {
  const text = `${title} ${excerpt}`.toLowerCase()
  const chips: string[] = []
  if (/\bai\b|llm|machine learning|neural/.test(text)) chips.push('AI')
  if (/lsp|language service|vendor|provider/.test(text)) chips.push('LSP')
  if (/platform|tool|workflow|software/.test(text)) chips.push('Tools')
  if (/regulation|law|compliance|policy/.test(text)) chips.push('Policy')
  return chips
}

export default async function MonthlyReportsPage() {
  const supabase = createPublicClient()
  const result = await supabase
    .from('articles')
    .select('id, title, slug, excerpt, published_at, signal_ids')
    .eq('article_type', 'monthly-summary')
    .order('published_at', { ascending: false })

  const posts = required(result, 'monthly reports') ?? []
  const latest = posts[0]
  const archive = posts.slice(1)

  return (
    <div className="container" style={{ paddingTop: 'var(--space-8)', paddingBottom: 'var(--space-12)' }}>

      {posts.length === 0 ? (
        <p style={{ color: 'var(--muted)', fontStyle: 'italic' }}>No monthly reports have been published yet.</p>
      ) : (
        <>
          {/* Featured — latest report */}
          <div className="mr-featured">
            <div className="mr-featured-label">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z"/>
              </svg>
              Latest Report
            </div>
            <h2 className="mr-featured-title">
              <Link href={articleHref(latest.slug)}>{latest.title}</Link>
            </h2>
            <p className="mr-featured-meta">
              {new Date(latest.published_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
              {''}
            </p>
            {latest.excerpt && <p className="mr-featured-excerpt">{latest.excerpt}</p>}
            {latest.signal_ids?.length > 0 && (
              <div className="mr-featured-signals">
                {latest.signal_ids.slice(0, 3).map((sig: string) => (
                  <span key={sig} className="mr-signal-chip">{sig.replace(/-/g, ' ')}</span>
                ))}
              </div>
            )}
            <Link href={articleHref(latest.slug)} className="mr-featured-cta">Read Full Report →</Link>
          </div>

          {/* Archive */}
          {archive.length > 0 && (
            <>
              <div className="mr-archive-header">
                <span className="mr-archive-title">Archive</span>
              </div>
              <div className="mr-archive-grid">
                {archive.map(post => {
                  const chips = getTopicChips(post.title, post.excerpt ?? '')
                  return (
                    <article key={post.id} className="mr-card">
                      <div className="mr-card-top">
                        <span className="mr-card-date">
                          {new Date(post.published_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                        </span>
                      </div>
                      <h3 className="mr-card-title">
                        <Link href={articleHref(post.slug)}>{post.title}</Link>
                      </h3>
                      {post.excerpt && <p className="mr-card-excerpt">{post.excerpt}</p>}
                      {chips.length > 0 && (
                        <div className="mr-card-topics">
                          {chips.map(t => <span key={t} className="mr-topic-chip">{t}</span>)}
                        </div>
                      )}
                      <Link href={articleHref(post.slug)} className="mr-card-link">Read report →</Link>
                    </article>
                  )
                })}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
