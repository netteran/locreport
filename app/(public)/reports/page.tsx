import Link from 'next/link'
import type { Metadata } from 'next'
import { ANNUAL_REPORTS, annualReportPath } from '@/lib/reports'
import { getReportImage } from '@/lib/reportImage'
import { createPublicClient } from '@/lib/supabase/server'
import { required } from '@/lib/supabase/required'
import { articleHref, safeImageUrl } from '@/lib/utils'
import { monthlyReportTitle, monthlyReportSubtitle, type BriefingCoverage } from '@/lib/briefingDisplay'
import { withOptionalBriefingCoverage } from '@/lib/briefingCoverage'
import type { Article } from '@/lib/types'

export const metadata: Metadata = {
  title: 'Localization Industry Reports',
  description: 'Read LocReport monthly reports on what changed in language services, why it matters, and what to watch next. Browse annual market reports in the archive.',
  alternates: { canonical: '/reports' },
}

export const revalidate = 3600

type BriefingListRow = Pick<Article, 'id' | 'title' | 'slug' | 'excerpt' | 'published_at' | 'image_url'> & BriefingCoverage

const publicationDate = new Intl.DateTimeFormat('en-US', {
  month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Europe/Warsaw',
})

export default async function ReportsPage() {
  const supabase = createPublicClient()
  const [briefings, annual] = await Promise.all([
    withOptionalBriefingCoverage(coverageColumns => supabase
      .from('articles')
      .select('id, title, slug, excerpt, published_at, image_url' + coverageColumns)
      .eq('article_type', 'monthly-summary')
      .order('published_at', { ascending: false })
      .order('id', { ascending: true })
      .returns<BriefingListRow[]>()),
    Promise.all(ANNUAL_REPORTS.map(async report => ({ ...report, image: await getReportImage(report.slug) }))),
  ])
  const posts = required(briefings, 'monthly reports') ?? []

  return (
    <main className="container public-page">
      <header className="reports-header public-page-heading">
        <h1>Reports</h1>
        <p>Monthly analysis of the localization industry and annual research on the global market.</p>
        <nav aria-label="Report sections">
          <a href="#monthly-reports">Monthly Reports</a>
          {annual.length > 0 && <a href="#annual-reports">Annual Reports</a>}
        </nav>
      </header>

      <section aria-labelledby="monthly-reports" className="reports-section">
        <h2 id="monthly-reports">Monthly Reports</h2>
        {posts.length === 0 && <p style={{ color: 'var(--muted)' }}>No monthly reports have been published yet.</p>}
        <div className="reports-list">
          {posts.map((post, index) => {
            const image = safeImageUrl(post.image_url)
            const title = monthlyReportTitle(post)
            const subtitle = monthlyReportSubtitle(post.excerpt)
            return (
              <Link key={post.id} href={articleHref(post.slug)} className="report-card">
                {image && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="report-card__image" src={image} alt="" loading="lazy" decoding="async" style={{ maxWidth: 120 }} />
                )}
                <div className="report-card__meta">
                  {index === 0 && <span className="report-card__type">Latest report</span>}
                  <time className="report-card__date" dateTime={post.published_at}>Published {publicationDate.format(new Date(post.published_at))}</time>
                </div>
                <h3 className="report-card__title">{title}</h3>
                {subtitle && <p className="report-card__desc">{subtitle}</p>}
                <span className="report-card__cta">Read report →</span>
              </Link>
            )
          })}
        </div>
      </section>

      {annual.length > 0 && (
        <section aria-labelledby="annual-reports" className="reports-section">
          <h2 id="annual-reports">Annual Reports</h2>
          <p style={{ color: 'var(--muted)', marginBottom: 'var(--space-4)' }}>Previously published reports, retained for reference.</p>
          <div className="reports-list">
            {annual.map(report => (
              <Link key={report.slug} href={annualReportPath(report.slug)} className="report-card" style={{ padding: 'var(--space-4)' }}>
                {report.image && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="report-card__image" src={report.image.url} alt="" loading="lazy" decoding="async" style={{ maxWidth: 120 }} />
                )}
                <div className="report-card__meta">
                  <span className="report-card__type">Archived annual report</span>
                  <span className="report-card__date">{report.date}</span>
                </div>
                <h3 className="report-card__title" style={{ fontSize: '1.1rem' }}>{report.title}</h3>
                <p className="report-card__desc">{report.description}</p>
                <span className="report-card__cta">Read archived report →</span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </main>
  )
}
