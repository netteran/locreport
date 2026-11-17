import type { Metadata } from 'next'
import Link from 'next/link'
import { createPublicClient } from '@/lib/supabase/server'
import { required } from '@/lib/supabase/required'
import { articleHref, safeImageUrl } from '@/lib/utils'
import { briefingCoverageLabel, type BriefingCoverage } from '@/lib/briefingDisplay'
import { withOptionalBriefingCoverage } from '@/lib/briefingCoverage'
import type { Article } from '@/lib/types'

export const metadata: Metadata = {
  title: 'Monthly Briefing',
  description: 'Monthly industry briefings connecting language-services evidence, meaningful shifts, practical consequences and questions to watch.',
  alternates: { canonical: '/reports/monthly' },
}

export const revalidate = 3600

type BriefingListRow = Pick<Article, 'id' | 'title' | 'slug' | 'excerpt' | 'published_at' | 'image_url' | 'image_alt'> & BriefingCoverage

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
  const result = await withOptionalBriefingCoverage(coverageColumns => supabase
    .from('articles')
    .select('id, title, slug, excerpt, published_at, image_url, image_alt' + coverageColumns)
    .eq('article_type', 'monthly-summary')
    .order('published_at', { ascending: false })
    .returns<BriefingListRow[]>()
  )

  const posts = required(result, 'monthly briefings') ?? []
  const latest = posts[0]
  const latestImage = latest ? safeImageUrl(latest.image_url) : null
  const archive = posts.slice(1)

  return (
    <div className="container" style={{ paddingTop: 'var(--space-8)', paddingBottom: 'var(--space-12)' }}>
      <section className="all-articles-hero">
        <h1>Monthly Briefing</h1>
        <p className="all-articles-subtitle">An editorial assessment of what changed, why it matters, and what to watch next, drawing on our reporting, Fact Flow and collected source evidence.</p>
      </section>

      {posts.length === 0 ? (
        <p style={{ color: 'var(--muted)', fontStyle: 'italic' }}>No monthly briefings have been published yet.</p>
      ) : (
        <>
          {/* Featured — latest report */}
          <div className={`mr-featured${latestImage ? ' mr-featured--with-image' : ''}`}>
            {latestImage && (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="mr-featured-image" src={latestImage} alt={latest.image_alt?.trim() || latest.title} loading="eager" decoding="async" />
            )}
            <div className="mr-featured-label">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z"/>
              </svg>
              Latest Briefing
            </div>
            <h2 className="mr-featured-title">
              <Link href={articleHref(latest.slug)}>{latest.title}</Link>
            </h2>
            <p className="mr-featured-meta">
              {briefingCoverageLabel(latest) ? `Coverage: ${briefingCoverageLabel(latest)} · ` : ''}
              Published {new Date(latest.published_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Europe/Warsaw' })}
            </p>
            {latest.excerpt && <p className="mr-featured-excerpt">{latest.excerpt}</p>}
            <Link href={articleHref(latest.slug)} className="mr-featured-cta">Read briefing →</Link>
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
                  const image = safeImageUrl(post.image_url)
                  return (
                    <article key={post.id} className="mr-card">
                      {image && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img className="mr-card-image" src={image} alt="" loading="lazy" decoding="async" />
                      )}
                      <div className="mr-card-top">
                        <span className="mr-card-date">
                          {briefingCoverageLabel(post) ? `Coverage: ${briefingCoverageLabel(post)}` : 'Monthly Briefing'}
                        </span>
                      </div>
                      <h3 className="mr-card-title">
                        <Link href={articleHref(post.slug)}>{post.title}</Link>
                      </h3>
                      <p className="mr-card-date">Published {new Date(post.published_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Europe/Warsaw' })}</p>
                      {post.excerpt && <p className="mr-card-excerpt">{post.excerpt}</p>}
                      {chips.length > 0 && (
                        <div className="mr-card-topics">
                          {chips.map(t => <span key={t} className="mr-topic-chip">{t}</span>)}
                        </div>
                      )}
                      <Link href={articleHref(post.slug)} className="mr-card-link">Read briefing →</Link>
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
