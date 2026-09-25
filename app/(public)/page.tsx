import Link from 'next/link'
import Image from 'next/image'
import type { Metadata } from 'next'
import { createPublicClient } from '@/lib/supabase/server'
import { Article } from '@/lib/types'
import { articleHref, safeImageUrl } from '@/lib/utils'
import { SIGNALS, SIGNAL_MAP } from '@/lib/signals'
import { MomentumStrip } from '@/components/MomentumStrip'
import { DigestPopupTrigger } from '@/components/DigestPopupTrigger'
import { getIntelligenceData, signalShortLabel } from '@/lib/intelligence'

export const metadata: Metadata = {
  alternates: { canonical: '/' },
}

// Tools surfaced in the hero "Explore" panel — blog + tools focus
const HERO_TOOLS = [
  { href: '/compass/llm-pricing', name: 'AI Cost Simulator', desc: 'Compare LLM pricing for localization' },
  { href: '/compass/locstock', name: 'LocStock', desc: 'Language-industry market tracker' },
  { href: '/intelligence/signals', name: 'Signals Tracker', desc: 'Trends shaping the industry' },
]

const SOURCES = [
  'TechCrunch','Slator','DeepL','TransPerfect','Crowdin','Phrase','Smartling',
  'Lokalise','NIMDZI','GALA','ELIA','XTM','LanguageLine','Vistatec','PR Newswire',
  'OpenAI','ChatGPT','Google Gemini','Anthropic','Claude','Meta AI','Llama',
  'Hugging Face','Mistral AI',
]

const IMPACT_LABEL: Record<number, string> = { 1: 'Routine', 2: 'Notable', 3: 'Significant', 4: 'Major', 5: 'Disruptive' }

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

// Columns the homepage actually renders. Narrower than `Article` so the
// query skips `embedding` (a ~15-20KB serialized vector per row) and other
// unused columns (tags, business_implications, etc.) across 60 rows. It also
// skips `content`: 60 full articles is ~156KB of markdown fetched to render
// nothing but excerpts, and this was measurably the slowest request the site
// made. Where an excerpt is missing the row simply renders without one.
type HomeArticle = Pick<
  Article,
  | 'id'
  | 'title'
  | 'slug'
  | 'excerpt'
  | 'author'
  | 'image_url'
  | 'signal_ids'
  | 'impact_score'
  | 'published_at'
>

export const revalidate = 3600

export default async function HomePage() {
  const supabase = createPublicClient()

  // Independent queries — run concurrently instead of paying for each
  // round trip in sequence.
  const [articlesResult, { data: latestFacts }, { data: latestReport }, intel] = await Promise.all([
    supabase
      .from('articles')
      .select('id, title, slug, excerpt, author, image_url, signal_ids, impact_score, published_at')
      .order('published_at', { ascending: false })
      .limit(60),
    supabase
      .from('facts')
      .select('id, content, created_at, article_id')
      .not('article_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(4),
    supabase
      .from('articles')
      .select('id, title, slug, excerpt, published_at')
      .eq('article_type', 'monthly-summary')
      .order('published_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    getIntelligenceData(supabase),
  ])

  // Depends on latestFacts, so it stays a follow-up query rather than
  // joining the batch above.
  const factArticleIds = [...new Set((latestFacts ?? []).map(f => f.article_id).filter(Boolean))]
  const factSlugMap = new Map<string, string>()
  if (factArticleIds.length > 0) {
    const { data: factArticles } = await supabase
      .from('articles')
      .select('id, slug')
      .in('id', factArticleIds as string[])
    for (const a of factArticles ?? []) factSlugMap.set(a.id, a.slug)
  }

  // Rendering an empty homepage on a failed query is worse than not
  // rendering one: it returns 200, so nothing downstream treats it as a
  // failure, and with ISR it would replace a good cached page with a blank
  // one. Throwing keeps the last good render being served.
  if (articlesResult.error) {
    throw new Error(`homepage articles query failed: ${articlesResult.error.message}`)
  }
  const allArticles = (articlesResult.data as HomeArticle[]) ?? []

  // Today's briefing: impact-ranked lead from the latest 10 articles,
  // plus a rail of recent high-impact stories.
  const leadPool = allArticles.slice(0, 10)
  const lead = [...leadPool].sort(
    (a, b) => (b.impact_score ?? 0) - (a.impact_score ?? 0) || b.published_at.localeCompare(a.published_at)
  )[0]
  const highImpactRail = allArticles
    .filter(a => a.id !== lead?.id && (a.impact_score ?? 0) >= 4)
    .slice(0, 4)
  const leadImage = safeImageUrl(lead?.image_url)
  const leadSignals = (lead?.signal_ids ?? [])
    .map(id => SIGNAL_MAP.get(id))
    .filter((s): s is NonNullable<typeof s> => Boolean(s))
    .slice(0, 3)

  // Group by day (up to 3 days)
  const byDay = new Map<string, HomeArticle[]>()
  for (const a of allArticles) {
    const day = new Date(a.published_at).toLocaleDateString('en-US', {
      year: 'numeric', month: '2-digit', day: '2-digit',
    })
    if (!byDay.has(day)) {
      if (byDay.size >= 3) break
      byDay.set(day, [])
    }
    byDay.get(day)!.push(a)
  }

  // Signal momentum strip: rising signals first, busiest coverage as filler
  const rising = intel.signalSeries.filter(s => s.observedMomentum === 'rising')
  const filler = intel.signalSeries
    .filter(s => s.observedMomentum !== 'rising')
    .sort((a, b) => b.recentCount - a.recentCount)
  const momentumItems = [...rising.sort((a, b) => b.recentCount - a.recentCount), ...filler]
    .slice(0, 4)
    .filter(s => s.recentCount > 0)
    .map(s => ({
      id: s.signalId,
      label: signalShortLabel(s.signalId),
      momentum: s.observedMomentum,
      recentCount: s.recentCount,
      weekly: s.weekly,
    }))

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
              Language services intelligence
            </span>
            <h1>LocReport — the pulse of the language services industry</h1>
            <p className="hero-subtitle">Daily coverage of translation, localization, and AI — curated, analyzed, and tracked through the signals that matter.</p>
            <div className="hero-actions">
              <Link href="/articles" className="btn btn--hero-articles">Browse articles</Link>
              <Link href="/intelligence" className="btn btn--hero-intel">Intelligence Dashboard</Link>
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
          {/* ── Highlighted story: impact-ranked lead + high-impact rail ── */}
          {lead && (
            <section className="briefing" aria-label="Highlighted story">
              <div className="briefing__head">
                <span className="briefing__eyebrow">Highlighted story</span>
                <span className="briefing__date">
                  {new Date(lead.published_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
                </span>
              </div>
              <div className={`briefing__grid${highImpactRail.length === 0 ? ' briefing__grid--single' : ''}`}>
                <article className="briefing__lead">
                  {leadImage && (
                    <Link href={articleHref(lead.slug)} className="briefing__lead-image" aria-hidden="true" tabIndex={-1}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={leadImage} alt="" loading="lazy" decoding="async" />
                    </Link>
                  )}
                  <div className="briefing__lead-meta">
                    {lead.impact_score && (
                      <span className={`impact-badge impact-badge--${lead.impact_score}`}>
                        {IMPACT_LABEL[lead.impact_score] ?? ''}
                      </span>
                    )}
                    {lead.author && <span className="briefing__publisher">{lead.author}</span>}
                  </div>
                  <h2 className="briefing__title"><Link href={articleHref(lead.slug)}>{lead.title}</Link></h2>
                  {lead.excerpt && <p className="briefing__excerpt">{lead.excerpt}</p>}
                  {leadSignals.length > 0 && (
                    <div className="briefing__signals">
                      {leadSignals.map(s => (
                        <Link key={s.id} href={`/intelligence/signals/${s.id}`} className="briefing__signal-chip">
                          {s.title.length > 42 ? s.title.slice(0, 42) + '…' : s.title}
                        </Link>
                      ))}
                    </div>
                  )}
                  <Link className="article-row__read-more" href={articleHref(lead.slug)}>Read the story →</Link>
                </article>
                {highImpactRail.length > 0 && (
                  <div className="briefing__rail" aria-label="High impact stories">
                    <span className="briefing__rail-label">High impact</span>
                    {highImpactRail.map(a => (
                      <Link key={a.id} href={articleHref(a.slug)} className="briefing__rail-item">
                        <span className="briefing__rail-item-title">{a.title}</span>
                        <span className="briefing__rail-item-meta">
                          {IMPACT_LABEL[a.impact_score ?? 0] ?? ''} · {new Date(a.published_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </span>
                      </Link>
                    ))}
                    <Link href="/intelligence/high-impact" className="sidebar-widget__more">All high-impact →</Link>
                  </div>
                )}
              </div>
            </section>
          )}

          <MomentumStrip items={momentumItems} />

          {[...byDay.entries()].map(([, allDayArticles], dayIndex) => {
            const dayArticles = allDayArticles.filter(a => a.id !== lead?.id)
            if (dayArticles.length === 0) return null
            const displayDate = new Date(allDayArticles[0].published_at).toLocaleDateString('en-US', {
              year: 'numeric', month: 'long', day: 'numeric',
            })
            return (
              <section key={dayIndex} className="day-section">
                <h2 className="day-header">{displayDate}</h2>
                <div className="article-list">
                  {dayArticles.map(article => {
                    const date = new Date(article.published_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                    const thumb = safeImageUrl(article.image_url)
                    return (
                      <article key={article.id} className={`article-row${thumb ? ' article-row--with-thumb' : ''}`}>
                        <div className="article-row__main">
                          <div className="article-row__header">
                            <span className="article-row__date">{date}</span>
                            {article.impact_score && article.impact_score >= 3 && (
                              <span className={`impact-dot impact-dot--${article.impact_score}`} title={`Impact: ${IMPACT_LABEL[article.impact_score]}`} />
                            )}
                          </div>
                          <h2 className="article-row__title"><Link href={articleHref(article.slug)}>{article.title}</Link></h2>
                          {article.excerpt && <p className="article-row__excerpt">{article.excerpt}</p>}
                          <div className="article-row__footer">
                            {article.author && <span className="article-row__publisher">{article.author}</span>}
                            <Link className="article-row__read-more" href={articleHref(article.slug)}>Read more →</Link>
                          </div>
                        </div>
                        {thumb && (
                          <Link href={articleHref(article.slug)} className="article-row__thumb" aria-hidden="true" tabIndex={-1}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={thumb} alt="" loading="lazy" decoding="async" />
                          </Link>
                        )}
                      </article>
                    )
                  })}
                </div>
              </section>
            )
          })}

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
              <p className="sidebar-factflow__desc">Verified facts as they break!</p>
              {latestFacts.map(fact => {
                const slug = fact.article_id ? factSlugMap.get(fact.article_id) : undefined
                return (
                  <div key={fact.id} className="sidebar-factflow__item">
                    <span className="sidebar-factflow__time">{timeAgo(fact.created_at)}</span>
                    {slug ? (
                      <Link href={articleHref(slug)} className="sidebar-factflow__content">{fact.content}</Link>
                    ) : (
                      <span className="sidebar-factflow__content">{fact.content}</span>
                    )}
                  </div>
                )
              })}
              <Link href="/fact-flow" className="sidebar-widget__more">Follow the live feed →</Link>
            </div>
          )}

          {latestReport && (
            <div className="sidebar-widget sidebar-widget--report">
              <p className="sidebar-report__eyebrow">Monthly Report · {new Date(latestReport.published_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</p>
              <h3 className="sidebar-report__title">{latestReport.title}</h3>
              <p className="sidebar-report__desc">{latestReport.excerpt ?? 'Key themes, signals, and trends from the language services industry.'}</p>
              <Link href={articleHref(latestReport.slug)} className="sidebar-report__link">Read the report →</Link>
            </div>
          )}

          <div className="sidebar-widget sidebar-widget--report">
            <p className="sidebar-report__eyebrow">2026 Report</p>
            <h3 className="sidebar-report__title">Global Market Report</h3>
            <p className="sidebar-report__desc">Market sizing, AI-era growth drivers, and strategic forecasts.</p>
            <a href="/reports/2026-Annual-Global-Market-Report/" className="sidebar-report__link">Read the report →</a>
          </div>

          <div className="sidebar-widget">
            <h3 className="sidebar-widget__title">Active Signals</h3>
            <div className="sidebar-signal-list">
              {SIGNALS.slice(0, 6).map(signal => (
                <Link key={signal.id} href={`/intelligence/signals/${signal.id}`} className="sidebar-signal">
                  <span className={`sidebar-signal__status sidebar-signal__status--${signal.current_status}`} aria-label={signal.current_status} />
                  <span className="sidebar-signal__title">{signal.title.length > 58 ? signal.title.slice(0, 58) + '…' : signal.title}</span>
                </Link>
              ))}
            </div>
            <Link href="/intelligence/signals" className="sidebar-widget__more">All {SIGNALS.length} signals →</Link>
          </div>
        </aside>
      </div>
    </div>
  )
}
