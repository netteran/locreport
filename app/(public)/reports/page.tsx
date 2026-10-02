import Link from 'next/link'
import type { Metadata } from 'next'
import { ANNUAL_REPORTS, annualReportPath } from '@/lib/reports'
import { getReportImage } from '@/lib/reportImage'

export const metadata: Metadata = {
  title: 'Reports',
  description: 'Periodic synthesis reports on the language services industry — monthly roundups and annual global market analysis.',
  alternates: { canonical: '/reports' },
}

// Annual report images are set from /admin/reports, which revalidates this page on save.
export const revalidate = 86400

export default async function ReportsPage() {
  const annual = await Promise.all(ANNUAL_REPORTS.map(async r => ({ ...r, image: await getReportImage(r.slug) })))

  return (
    <div className="container" style={{ paddingBottom: 'var(--space-12)' }}>
      <section className="intel-hero">
        <h1>Reports</h1>
        <p className="intel-subtitle">Synthesis reports on the language services industry, published on a monthly and annual basis.</p>
      </section>

      {/* Annual */}
      <section style={{ marginBottom: 'var(--space-10)' }}>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: 'var(--space-4)', borderBottom: '2px solid var(--border)', paddingBottom: 'var(--space-3)' }}>Annual</h2>
        <div className="reports-list">
          {annual.map(r => (
            <Link key={r.slug} href={annualReportPath(r.slug)} className="report-card">
              {r.image && (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="report-card__image" src={r.image.url} alt="" loading="lazy" decoding="async" />
              )}
              <div className="report-card__meta">
                <span className="report-card__type">Annual Report</span>
                <span className="report-card__date">{r.date}</span>
              </div>
              <h3 className="report-card__title">{r.title}</h3>
              <p className="report-card__desc">{r.description}</p>
              <span className="report-card__cta">Read report →</span>
            </Link>
          ))}
        </div>
      </section>

      {/* Monthly */}
      <section>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: 'var(--space-4)', borderBottom: '2px solid var(--border)', paddingBottom: 'var(--space-3)' }}>Monthly</h2>
        <div className="reports-list">
          <Link href="/reports/monthly" className="report-card">
            <div className="report-card__meta">
              <span className="report-card__type">Monthly Reports</span>
            </div>
            <h3 className="report-card__title">Monthly Industry Intelligence</h3>
            <p className="report-card__desc">Each month we scan hundreds of sources across translation, AI, and language technology — then distill the signals that matter for localization leaders.</p>
            <span className="report-card__cta">Browse all monthly reports →</span>
          </Link>
        </div>
      </section>
    </div>
  )
}
