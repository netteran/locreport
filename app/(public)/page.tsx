import Link from 'next/link'
import { Fragment } from 'react'
import { HomeFeedAd } from '@/components/HomeFeedAd'
import Image from 'next/image'
import type { Metadata } from 'next'
import { createPublicClient } from '@/lib/supabase/server'
import { loadPublishedFacts, httpUrl, factMainLink } from '@/lib/publicFacts'
import { Article } from '@/lib/types'
import { articleHref, safeImageUrl } from '@/lib/utils'
import { briefingCoverageLabel, type BriefingCoverage } from '@/lib/briefingDisplay'
import { withOptionalBriefingCoverage } from '@/lib/briefingCoverage'
import { DigestPopupTrigger } from '@/components/DigestPopupTrigger'

export const metadata: Metadata = {
  alternates: { canonical: '/' },
}

// Tools surfaced in the hero "Explore" panel — blog + tools focus
const HERO_TOOLS = [
  { href: '/compass/llm-pricing', name: 'AI Cost Simulator', desc: 'Compare LLM pricing for localization' },
  { href: '/compass/locstock', name: 'LocStock', desc: 'Language-industry market tracker' },
  { href: '/compass/directory', name: 'Tech Directory', desc: 'Language technology providers' },
]

const SOURCES = [
  'TechCrunch','Slator','DeepL','TransPerfect','Crowdin','Phrase','Smartling',
  'Lokalise','NIMDZI','GALA','ELIA','XTM','LanguageLine','Vistatec','PR Newswire',
  'OpenAI','ChatGPT','Google Gemini','Anthropic','Claude','Meta AI','Llama',
  'Hugging Face','Mistral AI',
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
    loadPublishedFacts(supabase,4),
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
  const reportCoverage = latestReport ? briefingCoverageLabel(latestReport) : null
  const thirdFeedArticleId = recentArticles[2]?.id

  return (
    // The homepage keeps the pre-Aug-17 visual system. `.home-v1` scopes both
    // that palette and the component CSS it needs (assets/css/style.css), so
    // the rest of the site stays on the current institutional-editorial look.
    <div className="home-v1">
      {/* ── Hero: Split Layout ── */}
      <section className="hero hero--split" id="hero-section">
        <div className="hero-bg" aria-hidden="true">
          <span className="hero-orb hero-orb--1" />
          <span className="hero-orb hero-orb--2" />
          <span className="hero-orb hero-orb--3" />
        </div>
        <div className="hero-split container">
          <div className="hero-split__left">
            <span className="hero-eyebrow">
              <Image className="hero-eyebrow-icon" src="/icon.png" alt="" width={18} height={18} aria-hidden="true" />
              Localization, language services &amp; AI
            </span>
            <h1>LocReport — the pulse of the language services industry</h1>
            <p className="hero-subtitle">Independent analysis connecting sources, industry experience and the developments that matter.</p>
            <div className="hero-actions">
              <Link href="/articles" className="btn btn--hero-articles">Browse articles</Link>
              <Link href="/fact-flow" className="btn btn--hero-intel">Follow Fact Flow</Link>
            </div>
          </div>
          <div className="hero-split__right" aria-label="Explore tools">
            <div className="hero-intel-panel">
              <div className="hero-tool-list">
                {HERO_TOOLS.map(tool => (
                  <Link key={tool.href} href={tool.href} className="hero-tool-row">
                    <span className="hero-tool-row__body">
                      <span className="hero-tool-row__name">{tool.name}</span>
                      <span className="hero-tool-row__desc">{tool.desc}</span>
                    </span>
                    <span className="hero-tool-row__arrow" aria-hidden="true">→</span>
                  </Link>
                ))}
              </div>
              <Link href="/compass" className="hero-intel-panel__footer">All tools →</Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── Sources Bar ── */}
      <div className="sources-bar" aria-hidden="true">
        <div className="sources-bar-track">
          {[...SOURCES, ...SOURCES].map((s, i) => (
            <span key={i} className="source-logo">{s}</span>
          ))}
        </div>
      </div>

      {/* ── Home Layout: Main + Sidebar ── */}
      <div className="home-layout container">
        <main className="home-main">
          {/* Latest authored article, with its actual publication date. */}
          {lead && (
            <section className="briefing" aria-label="Highlighted story">
              <div className="briefing__head">
                <span className="briefing__eyebrow">Latest analysis</span>
                <span className="briefing__date">
                  {new Date(lead.published_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
                </span>
              </div>
              <div className="briefing__grid briefing__grid--single">
                <article className="briefing__lead">
                  <div className={`briefing__lead-heading${leadImage ? ' briefing__lead-heading--with-image' : ''}`}>
                    <div className="briefing__lead-copy">
                      {lead.author && <span className="briefing__publisher">{lead.author}</span>}
                      <h2 className="briefing__title"><Link href={articleHref(lead.slug)}>{lead.title}</Link></h2>
                    </div>
                    {leadImage && (
                      <Link href={articleHref(lead.slug)} className="briefing__lead-image" aria-hidden="true" tabIndex={-1}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={leadImage} alt="" width={300} height={200} decoding="async" />
                      </Link>
                    )}
                  </div>
                  {lead.excerpt && <p className="briefing__excerpt">{lead.excerpt}</p>}
                  <Link className="article-row__read-more" href={articleHref(lead.slug)}>Read the story →</Link>
                </article>
              </div>
            </section>
          )}

          <HomeFeedAd placement="home-briefing" />

          {recentArticles.length > 0 && (
            <section className="day-section" aria-label="More analysis">
              <h2 className="day-header">More analysis</h2>
              <div className="article-list">
                {recentArticles.map(article => {
                  const date = new Date(article.published_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                  const thumb = safeImageUrl(article.image_url)
                  return (
                    <Fragment key={article.id}>
                      <article className="article-row">
                        <div className={`article-row__heading${thumb ? ' article-row__heading--with-thumb' : ''}`}>
                          <div className="article-row__main">
                            <div className="article-row__header">
                              <span className="article-row__date">{date}</span>
                            </div>
                            <h2 className="article-row__title"><Link href={articleHref(article.slug)}>{article.title}</Link></h2>
                          </div>
                          {thumb && (
                            <Link href={articleHref(article.slug)} className="article-row__thumb" aria-hidden="true" tabIndex={-1}>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={thumb} alt="" width={180} height={120} loading="lazy" decoding="async" />
                            </Link>
                          )}
                        </div>
                        {article.excerpt && <p className="article-row__excerpt">{article.excerpt}</p>}
                        <div className="article-row__footer">
                          {article.author && <span className="article-row__publisher">{article.author}</span>}
                          <Link className="article-row__read-more" href={articleHref(article.slug)}>Read more →</Link>
                        </div>
                      </article>
                      {article.id === thirdFeedArticleId && <HomeFeedAd />}
                    </Fragment>
                  )
                })}
              </div>
              <Link href="/articles" className="sidebar-widget__more">Browse all articles →</Link>
            </section>
          )}
          {!lead && <p>Our next analysis is on its way. Follow <Link href="/fact-flow">Fact Flow</Link> for the latest sourced news.</p>}

          {/* CTA — opens The Weekly popup; the popup stays the only signup form */}
          <section className="cta-section">
            <div className="cta-inner">
              <p className="cta-eyebrow">The Weekly</p>
              <h2>Get the week in five minutes.</h2>
              <p>
                A quick Friday roundup of the best stories in translation &amp; AI.
                Clean, useful, and zero spam.
              </p>
              <div className="cta-actions">
                <DigestPopupTrigger className="btn btn--primary btn--lg cta-weekly-btn">
                  Join The Weekly
                </DigestPopupTrigger>
                <Link href="/articles" className="cta-secondary-link">
                  Or browse all articles <span aria-hidden="true">→</span>
                </Link>
              </div>
              <p className="cta-note">Free <span aria-hidden="true">•</span> Unsubscribe anytime</p>
            </div>
          </section>
        </main>

        <aside className="home-sidebar" aria-label="Sidebar">
          {latestFacts && latestFacts.length > 0 && (
            <div className="sidebar-widget sidebar-widget--factflow">
              <div className="sidebar-widget__title-row">
                <h3 className="sidebar-widget__title" style={{ margin: 0 }}>
                  <span className="sidebar-factflow__dot" aria-hidden="true" />
                  Fact Flow — Live
                </h3>
              </div>
              <p className="sidebar-factflow__desc">Industry news, with original sources.</p>
              {latestFacts.map(fact => {
                const main = factMainLink(fact)
                const source = httpUrl(fact.source_url)
                return (
                  <div key={fact.id} className="sidebar-factflow__item">
                    <span className="sidebar-factflow__time">{timeAgo(fact.published_at||fact.created_at)}</span>
                    {main ? main.external ? (
                      <a href={main.href} target="_blank" rel="noopener noreferrer" className="sidebar-factflow__content">{fact.content}</a>
                    ) : <Link href={main.href} className="sidebar-factflow__content">{fact.content}</Link>
                      : <span className="sidebar-factflow__content">{fact.content}</span>}
                    {main && !main.external && source && <a className="text-xs underline" href={source} target="_blank" rel="noopener noreferrer">Original source ↗</a>}
                  </div>
                )
              })}
              <Link href="/fact-flow" className="sidebar-widget__more">Follow the live feed →</Link>
            </div>
          )}

          {latestReport && (
            <div className="sidebar-widget sidebar-widget--report">
              <p className="sidebar-report__eyebrow">Monthly Briefing{reportCoverage ? ` · ${reportCoverage}` : ''}</p>
              <h3 className="sidebar-report__title">{latestReport.title}</h3>
              <p className="sidebar-report__desc">{latestReport.excerpt ?? 'What mattered, what it means in practice and what to watch next.'}</p>
              <Link href={articleHref(latestReport.slug)} className="sidebar-report__link">Read the briefing →</Link>
              <Link href="/reports" className="sidebar-widget__more">All monthly briefings →</Link>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
