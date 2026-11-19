import Link from 'next/link'
import type { Metadata } from 'next'
import { ANNUAL_REPORTS, annualReportPath } from '@/lib/reports'
import { getReportImage } from '@/lib/reportImage'
import { createPublicClient } from '@/lib/supabase/server'
import { required } from '@/lib/supabase/required'
import { articleHref, safeImageUrl } from '@/lib/utils'
import { briefingCoverageLabel, type BriefingCoverage } from '@/lib/briefingDisplay'
import { withOptionalBriefingCoverage } from '@/lib/briefingCoverage'
import type { Article } from '@/lib/types'

export const metadata: Metadata = {
  title: 'Reports and Monthly Briefings',
  description: 'Read LocReport monthly briefings on what changed in language services, why it matters, and what to watch next. Browse annual market reports in the archive.',
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
  const posts = required(briefings, 'monthly briefings') ?? []

  return (
    <div className="container" style={{ paddingBottom: 'var(--space-12)' }}>
      <section className="intel-hero">
        <h1>Reports</h1>
        <p className="intel-subtitle">What changed in language services, why it matters, and what deserves attention next.</p>
      </section>

      <section aria-labelledby="monthly-briefings" style={{ marginBottom: 'var(--space-10)' }}>
        <h2 id="monthly-briefings" style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: 'var(--space-3)' }}>Monthly briefings</h2>
        {posts.length === 0 && <p style={{ color: 'var(--muted)' }}>No monthly briefings have been published yet.</p>}
        <div className="reports-list">
          {posts.map((post, index) => {
            const image = safeImageUrl(post.image_url)
            const coverage = briefingCoverageLabel(post)
            return (
              <Link key={post.id} href={articleHref(post.slug)} className="report-card">
                {image && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="report-card__image" src={image} alt="" loading="lazy" decoding="async" style={{ maxWidth: 120 }} />
                )}
                <div className="report-card__meta">
                  {index === 0 && <span className="report-card__type">Latest briefing</span>}
                  {coverage && <span className="report-card__date">Coverage: {coverage}</span>}
                  <time className="report-card__date" dateTime={post.published_at}>Published {publicationDate.format(new Date(post.published_at))}</time>
                </div>
                <h3 className="report-card__title">{post.title}</h3>
                {post.excerpt && <p className="report-card__desc">{post.excerpt}</p>}
                <span className="report-card__cta">Read briefing →</span>
              </Link>
            )
          })}
        </div>
      </section>

      {annual.length > 0 && (
        <section aria-labelledby="annual-reports" style={{ marginBottom: 'var(--space-10)' }}>
          <h2 id="annual-reports" style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: 'var(--space-3)' }}>Annual reports</h2>
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
    </div>
  )
}
