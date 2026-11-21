import Link from 'next/link'
import { ContentFeed } from '@/components/ContentFeed'
import { loadContentFeed } from '@/lib/contentFeed'
import { HomeLogoTicker } from '@/components/HomeLogoTicker'
import { SITE_URL } from '@/lib/seo'
import { createPublicClient } from '@/lib/supabase/server'
import { loadPublishedFacts, httpUrl, factMainLink } from '@/lib/publicFacts'
import { Article } from '@/lib/types'
import { articleHref } from '@/lib/contentTaxonomy'
import { monthlyReportTitle, monthlyReportSubtitle, type BriefingCoverage } from '@/lib/briefingDisplay'
import { withOptionalBriefingCoverage } from '@/lib/briefingCoverage'
import { DigestPopupTrigger } from '@/components/DigestPopupTrigger'

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

type HomeBriefing = Pick<Article, 'id' | 'title' | 'slug' | 'excerpt' | 'published_at' | 'content_type' | 'content_slug' | 'article_type'> & BriefingCoverage

export const revalidate = 3600

export default async function HomePage() {
  const supabase = createPublicClient()

  // Independent queries — run concurrently instead of paying for each
  // round trip in sequence.
  const [initial, latestFacts, { data: latestReport }] = await Promise.all([
    loadContentFeed(1),
    loadPublishedFacts(supabase, 3),
    withOptionalBriefingCoverage(coverageColumns => supabase
      .from('articles')
      .select('id, title, slug, excerpt, published_at, content_type, article_type, content_slug' + coverageColumns)
      .eq('content_type', 'report')
      .order('published_at', { ascending: false })
      .limit(1)
      .returns<HomeBriefing[]>()
      .maybeSingle()),
  ])

  const reportSubtitle = monthlyReportSubtitle(latestReport?.excerpt)

  return (
    <main className="editorial-home">
      {/* Next's metadata resolver drops the final slash for the root URL. */}
      <link rel="canonical" href={`${SITE_URL}/`} />
      <div className="editorial-home__inner">
        <ContentFeed initial={initial} companion={(
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
        )} />
        <div className="editorial-home__below">
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
                <h2><Link href={articleHref(latestReport)}>{monthlyReportTitle(latestReport)}</Link></h2>
                {reportSubtitle && <p>{reportSubtitle}</p>}
                <Link className="editorial-home__link" href="/reports/">All monthly reports →</Link>
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
