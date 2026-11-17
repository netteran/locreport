import Link from 'next/link'
import type { Metadata } from 'next'
import { ANNUAL_REPORTS, annualReportPath } from '@/lib/reports'
import { getReportImage } from '@/lib/reportImage'

export const metadata: Metadata = {
  title: 'Reports',
  description: 'The LocReport Monthly Briefing: what changed in language services, why it matters and what to watch next. Browse previously published reports in the archive.',
  alternates: { canonical: '/reports' },
}

// Annual report images are set from /admin/reports, which revalidates this page on save.
export const revalidate = 86400

export default async function ReportsPage() {
  const annual = await Promise.all(ANNUAL_REPORTS.map(async r => ({ ...r, image: await getReportImage(r.slug) })))

  return (
    <div className="container" style={{ paddingBottom: 'var(--space-12)' }}>
      <section className="intel-hero">
        <h1>Monthly Briefing</h1>
        <p className="intel-subtitle">What changed in language services, why it matters, and what deserves attention next.</p>
      </section>

      <section style={{ marginBottom: 'var(--space-10)' }}>
        <div className="reports-list">
          <Link href="/reports/monthly" className="report-card">
            <div className="report-card__meta">
              <span className="report-card__type">Monthly Briefing</span>
            </div>
            <h2 className="report-card__title">The month in perspective</h2>
            <p className="report-card__desc">Our editorial assessment connects published analysis, Fact Flow and collected source evidence to explain the shifts that matter, their practical consequences and the questions still open.</p>
            <span className="report-card__cta">Browse monthly briefings →</span>
          </Link>
        </div>
      </section>

      <section style={{ marginBottom: 'var(--space-10)' }}>
        <h2 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: 'var(--space-3)' }}>Report archive</h2>
        <p style={{ color: 'var(--muted)', marginBottom: 'var(--space-4)' }}>Previously published reports, retained for reference.</p>
        <div className="reports-list">
          {annual.map(r => (
            <Link key={r.slug} href={annualReportPath(r.slug)} className="report-card" style={{ padding: 'var(--space-4)' }}>
              {r.image && (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="report-card__image" src={r.image.url} alt="" loading="lazy" decoding="async" style={{ maxWidth: 120 }} />
              )}
              <div className="report-card__meta">
                <span className="report-card__type">Archived annual report</span>
                <span className="report-card__date">{r.date}</span>
              </div>
              <h3 className="report-card__title" style={{ fontSize: '1.1rem' }}>{r.title}</h3>
              <p className="report-card__desc">{r.description}</p>
              <span className="report-card__cta">Read archived report →</span>
            </Link>
          ))}
        </div>
      </section>

    </div>
  )
}
