import Link from 'next/link'
import type { Metadata } from 'next'
import { SIGNALS } from '@/lib/signals'
import { createPublicClient } from '@/lib/supabase/server'
import { required } from '@/lib/supabase/required'
import { getIntelligenceData } from '@/lib/intelligence'
import { SignalSparkline } from '@/components/SignalSparkline'

export const metadata: Metadata = {
  title: 'Signal Tracker — Intelligence',
  description: 'Track high-impact localization industry signals with linked evidence from published coverage on LocReport.',
  alternates: { canonical: '/intelligence/signals' },
}

export const revalidate = 3600

const MOMENTUM_LABEL: Record<string, string> = {
  rising: '↑ rising',
  declining: '↓ declining',
  stable: '→ stable',
}

export default async function SignalsPage() {
  const supabase = createPublicClient()

  const [articlesResult, intel] = await Promise.all([
    supabase.from('articles').select('signal_ids').neq('article_type', 'monthly-summary'),
    getIntelligenceData(supabase),
  ])
  const articles = required(articlesResult, 'signals articles')
  const seriesById = new Map(intel.signalSeries.map(s => [s.signalId, s]))

  const signalCounts = new Map<string, number>()
  for (const a of articles ?? []) {
    for (const sid of (a.signal_ids ?? [])) {
      signalCounts.set(sid, (signalCounts.get(sid) ?? 0) + 1)
    }
  }

  const supported = SIGNALS.filter(s => s.current_status === 'supported').length
  const emerging  = SIGNALS.filter(s => s.current_status === 'emerging').length
  const disputed  = SIGNALS.filter(s => s.current_status === 'disputed').length

  return (
    <div className="container" style={{ paddingTop: 'var(--space-8)', paddingBottom: 'var(--space-12)' }}>

      <div className="signals-hub-header">
        <h1 className="signals-hub-title">Signal Tracker</h1>
        <p className="signals-hub-desc">
          A living tracker of high-impact claims in localization and AI, with linked evidence from published coverage. Click any signal to explore its evidence base.
        </p>
        <div className="signals-hub-stats">
          <div className="signals-hub-stat">
            <span className="signals-hub-stat__num">{SIGNALS.length}</span>
            <span className="signals-hub-stat__label">Active Signals</span>
          </div>
          <div className="signals-hub-stat">
            <span className="signals-hub-stat__num signals-hub-stat__num--supported">{supported}</span>
            <span className="signals-hub-stat__label">Supported</span>
          </div>
          <div className="signals-hub-stat">
            <span className="signals-hub-stat__num signals-hub-stat__num--emerging">{emerging}</span>
            <span className="signals-hub-stat__label">Emerging</span>
          </div>
          <div className="signals-hub-stat">
            <span className="signals-hub-stat__num signals-hub-stat__num--disputed">{disputed}</span>
            <span className="signals-hub-stat__label">Disputed</span>
          </div>
        </div>
      </div>

      <div className="signals-index-grid">
        {SIGNALS.map(signal => {
          const count = signalCounts.get(signal.id) ?? 0
          return (
            <Link key={signal.id} href={`/intelligence/signals/${signal.id}`} className="signals-index-card">
              <div className="signals-index-card__top">
                <div className="signals-index-card__category-row">
                  <span className="signal-tile__category">{signal.category}</span>
                </div>
                <div className="signals-index-card__badges">
                  <span className={`status-badge status-badge--${signal.current_status}`}>{signal.current_status}</span>
                  <span className={`momentum-badge momentum-badge--pill momentum-badge--${signal.momentum}`}>
                    {MOMENTUM_LABEL[signal.momentum]}
                  </span>
                </div>
              </div>
              <h2 className="signals-index-card__title">{signal.title}</h2>
              <p className="signals-index-card__desc">{signal.description}</p>
              <SignalSparkline data={seriesById.get(signal.id)?.weekly ?? []} height={30} />
              <div className="signals-index-card__bottom">
                <span className="signal-tile__count">{count} article{count !== 1 ? 's' : ''}</span>
                <span className="signals-index-card__cta">View signal →</span>
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
