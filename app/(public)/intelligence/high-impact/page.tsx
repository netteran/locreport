import Link from 'next/link'
import type { Metadata } from 'next'
import { createPublicClient } from '@/lib/supabase/server'
import { required } from '@/lib/supabase/required'
import { Article } from '@/lib/types'
import { articleHref } from '@/lib/utils'

export const metadata: Metadata = {
  title: 'High Impact Articles — Intelligence',
  description: 'Recent high-impact localization industry articles scoring 3 or above on the Localization Impact Scale.',
  alternates: { canonical: '/intelligence/high-impact' },
}

export const revalidate = 3600

const IMPACT_LABEL: Record<number, string> = { 3: 'Significant', 4: 'Major', 5: 'Disruptive' }

export default async function HighImpactPage() {
  const supabase = createPublicClient()

  const result = await supabase
    .from('articles')
    .select('id, title, slug, excerpt, publisher, impact_score, time_horizon, business_implications, affected_segments, published_at')
    .neq('article_type', 'monthly-summary')
    .gte('impact_score', 3)
    .order('impact_score', { ascending: false })
    .order('published_at', { ascending: false })
    .limit(12)

  const articles = (required(result, 'high-impact articles') as Article[]) ?? []

  return (
    <div className="container" style={{ paddingBottom: 'var(--space-12)' }}>
      <section className="intel-hero">
        <h1>High Impact Articles</h1>
        <p className="intel-subtitle">Recent articles scoring 3+ on the Localization Impact Scale.</p>
        <p style={{ textAlign: 'center', marginTop: 'var(--space-2)' }}>
          <Link href="/intelligence" style={{ color: 'var(--accent)', fontSize: '0.88rem', fontWeight: 600 }}>← Back to Intelligence</Link>
        </p>
      </section>

      <section className="intel-section" id="high-impact-section">
        <div className="intel-legend">
          <div className="intel-legend-group">
            <span className="intel-legend-label">Impact</span>
            <span className="impact-badge impact-badge--3 impact-badge--sm">Significant</span>
            <span className="impact-badge impact-badge--4 impact-badge--sm">Major</span>
            <span className="impact-badge impact-badge--5 impact-badge--sm">Disruptive</span>
          </div>
          <div className="intel-legend-sep" />
          <div className="intel-legend-group">
            <span className="intel-legend-label">Time horizon</span>
            <span className="time-horizon-badge time-horizon-badge--now time-horizon-badge--sm">Now — Immediate</span>
            <span className="time-horizon-badge time-horizon-badge--6months time-horizon-badge--sm">6mo — Near-term</span>
            <span className="time-horizon-badge time-horizon-badge--2years time-horizon-badge--sm">2yr — Long-term</span>
          </div>
        </div>

        {articles.length === 0 ? (
          <p className="intel-empty">No high-impact articles yet. Intelligence scoring applies to new articles as they are published.</p>
        ) : (
          <div className="intel-high-impact-list">
            {articles.map(a => {
              const date = new Date(a.published_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
              return (
                <Link key={a.id} href={articleHref(a.slug)} className="intel-impact-item">
                  <div className="intel-impact-item-top">
                    {a.impact_score && (
                      <span className={`impact-badge impact-badge--${a.impact_score} impact-badge--sm`}>
                        {IMPACT_LABEL[a.impact_score] ?? ''}
                      </span>
                    )}
                    {a.time_horizon && (
                      <span className={`time-horizon-badge time-horizon-badge--${a.time_horizon} time-horizon-badge--sm`}>
                        {a.time_horizon === 'now' ? 'Now' : a.time_horizon === '6months' ? '6mo' : '2yr'}
                      </span>
                    )}
                    <span className="intel-impact-date">{date}</span>
                  </div>
                  <h2 className="intel-impact-title">{a.title}</h2>
                  {a.business_implications?.[0] ? (
                    <p className="intel-impact-implication">{a.business_implications[0]}</p>
                  ) : a.excerpt ? (
                    <p className="intel-impact-implication">{a.excerpt}</p>
                  ) : null}
                  {a.affected_segments?.length > 0 && (
                    <div className="intel-impact-segments">
                      {a.affected_segments.map(seg => (
                        <span key={seg} className="segment-tag segment-tag--sm">{seg}</span>
                      ))}
                    </div>
                  )}
                </Link>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
