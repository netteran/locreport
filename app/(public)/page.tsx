import Link from 'next/link'
import { Fragment } from 'react'
import { HomeFeedAd } from '@/components/HomeFeedAd'
import { HomeLogoTicker } from '@/components/HomeLogoTicker'
import type { Metadata } from 'next'
import { createPublicClient } from '@/lib/supabase/server'
import { loadPublishedFacts, httpUrl, factMainLink } from '@/lib/publicFacts'
import { Article } from '@/lib/types'
import { articleHref, safeImageUrl } from '@/lib/utils'
import { monthlyReportTitle, monthlyReportSubtitle, type BriefingCoverage } from '@/lib/briefingDisplay'
import { withOptionalBriefingCoverage } from '@/lib/briefingCoverage'
import { DigestPopupTrigger } from '@/components/DigestPopupTrigger'
import './homepage.css'

export const metadata: Metadata = {
  alternates: { canonical: '/' },
}

const TOOLS = [
  { href: '/locstock', name: 'LocStock' },
  { href: '/directory', name: 'Directory' },
  { href: '/llm-pricing', name: 'AI Cost Simulator' },
]

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

// Fetch only the fields rendered in the latest-articles list.
type HomeArticle = Pick<
  Article,
  | 'id'
  | 'title'
  | 'slug'
  | 'excerpt'
  | 'author'
  | 'image_url'
  | 'published_at'
>

type HomeBriefing = Pick<Article, 'id' | 'title' | 'slug' | 'excerpt' | 'published_at'> & BriefingCoverage

export const revalidate = 3600

export default async function HomePage() {
  const supabase = createPublicClient()

  // Independent queries — run concurrently instead of paying for each
  // round trip in sequence.
  const [articlesResult, latestFacts, { data: latestReport }] = await Promise.all([
    supabase
      .from('articles')
      .select('id, title, slug, excerpt, author, image_url, published_at')
      .eq('article_type', 'industry')
      .order('published_at', { ascending: false })
      .limit(13),
    loadPublishedFacts(supabase, 3),
    withOptionalBriefingCoverage(coverageColumns => supabase
      .from('articles')
      .select('id, title, slug, excerpt, published_at' + coverageColumns)
      .eq('article_type', 'monthly-summary')
      .order('published_at', { ascending: false })
      .limit(1)
      .returns<HomeBriefing[]>()
      .maybeSingle()),
  ])

  // Rendering an empty homepage on a failed query is worse than not
  // rendering one: it returns 200, so nothing downstream treats it as a
  // failure, and with ISR it would replace a good cached page with a blank
  // one. Throwing keeps the last good render being served.
  if (articlesResult.error) {
    throw new Error(`homepage articles query failed: ${articlesResult.error.message}`)
  }
  const allArticles = (articlesResult.data as HomeArticle[]) ?? []

  const lead = allArticles[0]
  const recentArticles = allArticles.slice(1)
  const leadImage = safeImageUrl(lead?.image_url)
  const reportSubtitle = monthlyReportSubtitle(latestReport?.excerpt)
  const hasAdditionalFeedArticles = recentArticles.length > 3

  return (
    <main className="editorial-home">
      <div className="editorial-home__inner">
        <div className="editorial-home__top">
          <div className="editorial-home__opening">
            {lead ? (
              <article className="editorial-home__lead" aria-label="Latest analysis">
                <div className="editorial-home__lead-copy">
                  <p className="editorial-home__label">Latest analysis</p>
                  <h1><Link href={articleHref(lead.slug)}>{lead.title}</Link></h1>
                  {lead.excerpt && <p className="editorial-home__summary">{lead.excerpt}</p>}
                  <p className="editorial-home__byline">
                    {lead.author && <>{lead.author} · </>}
                    <time dateTime={lead.published_at}>
                      {new Date(lead.published_at).toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' })}
                    </time>
                  </p>
                  <Link className="editorial-home__read" href={articleHref(lead.slug)}>Read the analysis</Link>
                </div>
                {leadImage && (
                  <Link className="editorial-home__image" href={articleHref(lead.slug)} aria-hidden="true" tabIndex={-1}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={leadImage} alt="" width={1120} height={700} fetchPriority="high" />
                  </Link>
                )}
              </article>
            ) : (
              <section className="editorial-home__lead">
                <h1>LocReport</h1>
                <p>Our next analysis is on its way. Follow <Link href="/fact-flow">Fact Flow</Link> for the latest sourced news.</p>
              </section>
            )}
            <div className="editorial-home__updates-column">
              <section className="editorial-home__fact-flow" aria-labelledby="home-fact-flow">
                <div className="editorial-home__fact-flow-heading">
                  <h2 id="home-fact-flow">Fact Flow</h2>
                  {latestFacts.length > 0 && <span className="editorial-home__live">Live</span>}
                  <Link className="editorial-home__link" href="/fact-flow">All updates</Link>
                </div>
                {latestFacts.length > 0 && (
                  <ul className="editorial-home__updates">
                    {latestFacts.map(fact => {
                      const timestamp = fact.published_at || fact.created_at
                      const main = factMainLink(fact)
                      const source = httpUrl(fact.source_url)
                      return (
                        <li key={fact.id}>
                          <p className="editorial-home__fact-meta">
                            <time dateTime={timestamp}>{timeAgo(timestamp)}</time>
                            {fact.source_name && <> · {fact.source_name}</>}
                          </p>
                          <p>{main ? main.external ? (
                            <a href={main.href} target="_blank" rel="noopener noreferrer">{fact.content}</a>
                          ) : <Link href={main.href}>{fact.content}</Link> : fact.content}</p>
                          {main && !main.external && source && (
                            <a className="editorial-home__link" href={source} target="_blank" rel="noopener noreferrer">Original source ↗</a>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </section>
              <HomeLogoTicker />
            </div>
          </div>
        </div>
        <div className="editorial-home__below">
          <div className="editorial-home__feed">
            {recentArticles.length > 0 && (
              <section className="day-section" aria-label="More analysis">
                <div className="editorial-home__section-heading">
                  <h2>More analysis</h2>
                  <Link href="/articles">All articles</Link>
                </div>
                <div className="editorial-home__analysis-grid">
                  {recentArticles.map((article, index) => {
                    const date = new Date(article.published_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                    const thumb = safeImageUrl(article.image_url)
                    const href = articleHref(article.slug)
                    return (
                      <Fragment key={article.id}>
                        <article className="editorial-home__card">
                          {thumb && (
                            <Link href={href} className="editorial-home__card-image" aria-hidden="true" tabIndex={-1}>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={thumb} alt="" width={640} height={360} loading="lazy" decoding="async" />
                            </Link>
                          )}
                          <div className="editorial-home__card-copy">
                            <time dateTime={article.published_at}>{date}</time>
                            <h3><Link href={href}>{article.title}</Link></h3>
                            {article.excerpt && <p>{article.excerpt}</p>}
                            {article.author && <p className="editorial-home__card-author">{article.author}</p>}
                          </div>
                        </article>
                        {hasAdditionalFeedArticles && index === 2 && (
                          <div className="editorial-home__ad">
                            <HomeFeedAd placement="home-briefing" />
                          </div>
                        )}
                      </Fragment>
                    )
                  })}
                </div>
              </section>
            )}

            <HomeFeedAd placement={hasAdditionalFeedArticles ? 'home-feed' : 'home-briefing'} />
          </div>
          <section className="editorial-home__weekly" aria-labelledby="home-weekly">
            <div className="editorial-home__weekly-copy">
              <p className="editorial-home__label">The Weekly</p>
              <h2 id="home-weekly">Get the week in five minutes</h2>
              <p>A Friday roundup of the best stories in translation and AI.</p>
            </div>
            <div className="editorial-home__weekly-action">
              <DigestPopupTrigger className="btn btn--primary">
                Join The Weekly
              </DigestPopupTrigger>
              <p>Free · Unsubscribe anytime</p>
            </div>
          </section>
          <div className="editorial-home__resources">
            {latestReport && (
              <section className="editorial-home__report" aria-label="Monthly Report">
                <p className="editorial-home__label">Monthly Report</p>
                <h2><Link href={articleHref(latestReport.slug)}>{monthlyReportTitle(latestReport)}</Link></h2>
                {reportSubtitle && <p>{reportSubtitle}</p>}
                <Link className="editorial-home__link" href="/reports">All monthly reports →</Link>
              </section>
            )}
            <nav id="tools" className="editorial-home__tools" aria-labelledby="home-tools">
              <h2 id="home-tools">Tools</h2>
              <ul>
                {TOOLS.map(tool => (
                  <li key={tool.href}><Link href={tool.href}>{tool.name}</Link></li>
                ))}
              </ul>
            </nav>
          </div>
        </div>
      </div>
    </main>
  )
}
