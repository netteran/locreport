import Link from 'next/link'
import type { Metadata } from 'next'
import { SIGNALS } from '@/lib/signals'
import { createPublicClient } from '@/lib/supabase/server'
import { required } from '@/lib/supabase/required'
import { SubscribeForm } from '@/components/SubscribeForm'
import { getIntelligenceData, signalShortLabel } from '@/lib/intelligence'
import { SignalMomentumChart } from './SignalMomentumChart'
import { ImpactDistributionChart } from './ImpactDistributionChart'

export const metadata: Metadata = {
  title: 'Intelligence',
  description: 'Actionable localization intelligence — trend signals, impact scoring, and strategic decision-making.',
  alternates: { canonical: '/intelligence' },
}

export const revalidate = 3600

export default async function IntelligencePage() {
  const supabase = createPublicClient()

  const [articlesResult, intel] = await Promise.all([
    supabase.from('articles').select('impact_score, published_at'),
    getIntelligenceData(supabase),
  ])
  const articles = required(articlesResult, 'intelligence articles')

  const totalArticles = articles?.length ?? 0
  const highImpact = (articles ?? []).filter(a => (a.impact_score ?? 0) >= 4).length
  const nowMonth = new Date().toISOString().slice(0, 7)
  const thisMonth = (articles ?? []).filter(a => a.published_at?.slice(0, 7) === nowMonth).length

  const seriesById = new Map(intel.signalSeries.map(s => [s.signalId, s]))
  const momentumPanels = intel.topSignalIds.map(id => {
    const s = seriesById.get(id)!
    return {
      id,
      label: signalShortLabel(id),
      momentum: s.observedMomentum,
      total: s.total,
      monthly: intel.monthlyRows.map(row => ({ month: row.month, count: (row[id] as number) ?? 0 })),
    }
  })

  return (
    <div className="container" style={{ paddingBottom: 'var(--space-12)' }}>
      <section className="intel-hero">
        <h1>Localization Intelligence Dashboard</h1>
        <p className="intel-subtitle">Less noise, more clarity. Structured, decision-ready intelligence for the localization industry.</p>
      </section>

      <section className="intel-stats-grid" aria-label="Intelligence overview statistics">
        <div className="intel-stat-card">
          <span className="intel-stat-number">{totalArticles.toLocaleString()}</span>
          <span className="intel-stat-label">Articles Tracked</span>
        </div>
        <div className="intel-stat-card">
          <span className="intel-stat-number">{highImpact}</span>
          <span className="intel-stat-label">High Impact (4–5)</span>
        </div>
        <div className="intel-stat-card">
          <span className="intel-stat-number">{SIGNALS.length}</span>
          <span className="intel-stat-label">Active Signals</span>
        </div>
        <div className="intel-stat-card">
          <span className="intel-stat-number">{thisMonth}</span>
          <span className="intel-stat-label">This Month</span>
        </div>
      </section>

      <section className="intel-section" aria-label="Signal coverage momentum">
        <h2 className="intel-section__title">Signal coverage momentum</h2>
        <p className="intel-section__sub">
          Monthly article volume for the five most-covered signals over the last 12 months.
          Momentum compares the trailing 8 weeks of coverage with the 8 before.
        </p>
        <SignalMomentumChart panels={momentumPanels} />
      </section>

      <section className="intel-section" aria-label="Impact distribution">
        <h2 className="intel-section__title">Impact distribution</h2>
        <p className="intel-section__sub">
          How coverage skews across impact levels — the last 90 days against the 90 before.
        </p>
        <ImpactDistributionChart data={intel.impactBuckets} />
      </section>

      <section className="intel-link-grid" aria-label="Intelligence tools">
        <Link href="/intelligence/signals" className="intel-link-card">
          <span className="intel-link-card__eyebrow">Tracker</span>
          <span className="intel-link-card__title">Signals tracker</span>
          <span className="intel-link-card__desc">Track active localization and AI signals with linked article evidence.</span>
          <span className="intel-link-card__cta">Open tracker →</span>
        </Link>
        <Link href="/intelligence/high-impact" className="intel-link-card">
          <span className="intel-link-card__eyebrow">Articles</span>
          <span className="intel-link-card__title">High Impact Articles</span>
          <span className="intel-link-card__desc">Review recent significant, major, and disruptive localization industry coverage.</span>
          <span className="intel-link-card__cta">Open articles →</span>
        </Link>
      </section>

      <section className="subscribe-band" aria-label="Subscribe to the digest">
        <div className="subscribe-band__copy">
          <h2 className="subscribe-band__title">Signals in your inbox</h2>
          <p className="subscribe-band__text">
            Follow the signals you care about — the weekly digest filters
            stories to your picks and minimum impact level.
          </p>
        </div>
        <SubscribeForm />
      </section>

      <div className="intel-disclaimer">
        <strong>Data note:</strong> The intelligence presented here is derived from analysis of published industry articles and publications gathered by LocReport — not from direct market surveys or primary research. Signal statuses, trends, and scores reflect patterns observed in media coverage and curated content, and may not represent definitive market realities. Treat this as a directional research tool to complement, not replace, your own primary research.
      </div>
    </div>
  )
}
