import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'
import { SIGNAL_MAP, STATUS_LABEL, MOMENTUM_ICON, CATEGORY_COLOR } from '@/lib/signals'
import { createPublicClient } from '@/lib/supabase/server'
import { Article } from '@/lib/types'
import { articleHref } from '@/lib/utils'
import { computeMomentum, weeklySeries } from '@/lib/intelligence'
import { SignalSparkline } from '@/components/SignalSparkline'

export const revalidate = 3600

type Props = { params: Promise<{ id: string }> }

const STATUS_CLASS: Record<string, string> = {
  supported: 'status-badge--supported',
  emerging: 'status-badge--emerging',
  disputed: 'status-badge--challenged',
}

const IMPACT_LABEL: Record<number, string> = { 1: 'Routine', 2: 'Notable', 3: 'Significant', 4: 'Major', 5: 'Disruptive' }

export async function generateStaticParams() {
  return Array.from(SIGNAL_MAP.keys()).map(id => ({ id }))
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  const signal = SIGNAL_MAP.get(id)
  if (!signal) return {}
  return {
    title: `${signal.title} — Intelligence`,
    description: signal.description,
    alternates: { canonical: `/intelligence/signals/${id}` },
  }
}

export default async function SignalPage({ params }: Props) {
  const { id } = await params
  const signal = SIGNAL_MAP.get(id)
  if (!signal) notFound()

  const supabase = createPublicClient()

  // Fetch all articles referencing this signal
  const { data: raw } = await supabase
    .from('articles')
    .select('id, title, slug, excerpt, publisher, impact_score, signal_stance, published_at')
    .contains('signal_ids', [id])
    .neq('article_type', 'monthly-summary')
    .order('published_at', { ascending: false })

  const articles = (raw as Article[]) ?? []

  // Stance breakdown
  const stances = { supports: 0, mixed: 0, contradicts: 0, mentions: 0 }
  for (const a of articles) {
    const stance = a.signal_stance?.toLowerCase() ?? 'mentions'
    if (stance in stances) stances[stance as keyof typeof stances]++
    else stances.mentions++
  }

  // Related signals (other signals that appear alongside this one)
  const { data: allArticles } = await supabase
    .from('articles')
    .select('signal_ids')
    .contains('signal_ids', [id])
  const coOccurrences = new Map<string, number>()
  for (const a of allArticles ?? []) {
    for (const sid of (a.signal_ids ?? [])) {
      if (sid !== id) coOccurrences.set(sid, (coOccurrences.get(sid) ?? 0) + 1)
    }
  }
  const relatedSignals = Array.from(coOccurrences.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([sid, count]) => ({ signal: SIGNAL_MAP.get(sid), count }))
    .filter(r => r.signal != null)

  return (
    <div className="container">
      <div className="signal-page">
        {/* Breadcrumbs */}
        <nav className="signal-page__breadcrumbs">
          <Link href="/intelligence">Intelligence</Link>
          <span>›</span>
          <Link href="/intelligence/signals">Signals</Link>
          <span>›</span>
          <span style={{ color: 'var(--text)' }}>{signal!.title.slice(0, 50)}{signal!.title.length > 50 ? '…' : ''}</span>
        </nav>

        {/* Header */}
        <div className="signal-page__header">
          <div className="signal-page__meta-row">
            <span className={`status-badge ${STATUS_CLASS[signal!.current_status]}`}>{STATUS_LABEL[signal!.current_status]}</span>
            <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--muted)' }}>
              {MOMENTUM_ICON[signal!.momentum]} {signal!.momentum} momentum
            </span>
            <span style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: CATEGORY_COLOR[signal!.category], background: `color-mix(in srgb, ${CATEGORY_COLOR[signal!.category]} 10%, transparent)`, padding: '2px 8px', borderRadius: '100px' }}>
              {signal!.category}
            </span>
            <span className="signal-page__first-seen">First tracked: {signal!.first_seen}</span>
          </div>
          <h1 className="signal-page__title">{signal!.title}</h1>
          <p className="signal-page__description">{signal!.description}</p>

          {/* Tickers */}
          {signal!.watched_tickers.length > 0 && (
            <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', marginTop: 'var(--space-2)' }}>
              <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--muted)', alignSelf: 'center' }}>Watching:</span>
              {signal!.watched_tickers.map(t => (
                <span key={t} style={{ fontSize: '0.7rem', fontWeight: 700, fontFamily: 'monospace', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: '4px', padding: '2px 7px', color: 'var(--text)' }}>{t}</span>
              ))}
            </div>
          )}
        </div>

        {/* Stats */}
        <div className="signal-page__stats" style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap', marginBottom: 'var(--space-6)', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-3) var(--space-4)' }}>
          <div className="signal-page__stat">
            <span className="signal-page__stat-num">{articles.length}</span>
            <span className="signal-page__stat-label">Total articles</span>
          </div>
          <div className="signal-page__stat">
            <span className="signal-page__stat-num signal-page__stat-num--supports">{stances.supports}</span>
            <span className="signal-page__stat-label">Supports</span>
          </div>
          <div className="signal-page__stat">
            <span className="signal-page__stat-num signal-page__stat-num--mixed">{stances.mixed}</span>
            <span className="signal-page__stat-label">Mixed</span>
          </div>
          <div className="signal-page__stat">
            <span className="signal-page__stat-num signal-page__stat-num--contradicts">{stances.contradicts}</span>
            <span className="signal-page__stat-label">Contradicts</span>
          </div>
        </div>

        {/* Coverage trend */}
        {(() => {
          const weekly = weeklySeries(articles.map(a => a.published_at))
          const recent = weekly.slice(8).reduce((sum, w) => sum + w.count, 0)
          const prior = weekly.slice(0, 8).reduce((sum, w) => sum + w.count, 0)
          const momentum = computeMomentum(recent, prior)
          return (
            <div className="signal-page__section">
              <h2 className="signal-page__section-title">Coverage trend</h2>
              <p className="signal-page__section-desc">
                Weekly article volume over the last 16 weeks — coverage momentum is{' '}
                <strong>{momentum}</strong> ({recent} article{recent !== 1 ? 's' : ''} in the
                trailing 8 weeks vs {prior} before).
              </p>
              <SignalSparkline data={weekly} height={56} />
            </div>
          )
        })()}

        {/* Related signals */}
        {relatedSignals.length > 0 && (
          <div className="signal-page__section">
            <h2 className="signal-page__section-title">Related signals</h2>
            <p className="signal-page__section-desc">Signals that frequently co-appear in the same articles.</p>
            <ul className="signal-page__related">
              {relatedSignals.map(({ signal: rel, count }) => (
                <li key={rel!.id}>
                  <Link href={`/intelligence/signals/${rel!.id}`} className="signal-page__related-link">
                    <span className="signal-page__related-title">{rel!.title}</span>
                    <span className="signal-page__related-count">{count} shared article{count !== 1 ? 's' : ''}</span>
                    <span className="signal-page__related-arrow">→</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Evidence articles */}
        <div className="signal-page__section">
          <h2 className="signal-page__section-title">Evidence — {articles.length} article{articles.length !== 1 ? 's' : ''}</h2>
          <p className="signal-page__section-desc">Articles that reference this signal.</p>

          {articles.length === 0 ? (
            <div className="signal-page__empty">No articles reference this signal yet.</div>
          ) : (
            <ul className="signal-page__evidence">
              {articles.map(a => {
                const date = new Date(a.published_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                return (
                  <li key={a.id} className="signal-page__evidence-item">
                    <Link href={articleHref(a.slug)} className="signal-page__evidence-title">{a.title}</Link>
                    <div className="signal-page__evidence-meta">
                      <span>{date}</span>
                      {a.publisher && <span>· {a.publisher}</span>}
                      {a.impact_score && a.impact_score >= 2 && (
                        <span className={`article-card-impact article-card-impact--${a.impact_score}`}>{IMPACT_LABEL[a.impact_score]}</span>
                      )}
                      {a.signal_stance && (
                        <span className={`stance-dot stance-dot--${a.signal_stance.toLowerCase()}`}>{a.signal_stance}</span>
                      )}
                    </div>
                    {a.excerpt && <p className="signal-page__evidence-excerpt">{a.excerpt.length > 180 ? a.excerpt.slice(0, 180) + '…' : a.excerpt}</p>}
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="signal-page__back">
          <Link href="/intelligence/signals">← All signals</Link>
        </div>
      </div>
    </div>
  )
}
