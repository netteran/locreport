import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Intelligence and Signals Tracker retired',
  description: 'LocReport now brings its industry analysis into authored articles and the Monthly Report.',
  robots: { index: false, follow: true },
  alternates: { canonical: '/intelligence' },
}

export default function IntelligencePage() {
  return (
    <div className="container" style={{ paddingTop: 'var(--space-10)', paddingBottom: 'var(--space-12)' }}>
      <div style={{ maxWidth: 'var(--content-width)', margin: '0 auto' }}>
        <h1>Intelligence and Signals Tracker have been retired</h1>
        <p className="intel-subtitle" style={{ textAlign: 'left' }}>
          LocReport now brings its industry analysis into authored, multisource articles and the Monthly Report.
          The former dashboard, signal tracking and high-impact rankings are no longer updated.
        </p>
        <p>
          Explore our articles for context and practical implications, or read the Monthly Report for the
          developments that mattered and the questions to watch next. Fact Flow continues to carry the latest
          industry news with links to original sources.
        </p>
        <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap', marginTop: 'var(--space-6)' }}>
          <Link href="/" className="btn btn--primary">Browse articles</Link>
          <Link href="/reports/" className="btn btn--ghost">Read the Monthly Report</Link>
          <Link href="/fact-flow" className="btn btn--ghost">Follow Fact Flow</Link>
        </div>
      </div>
    </div>
  )
}
