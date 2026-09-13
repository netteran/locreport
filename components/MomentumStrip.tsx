'use client'

import Link from 'next/link'
import dynamic from 'next/dynamic'
import type { SparkPoint } from '@/components/SignalSparkline'

// Recharts stays out of the homepage's initial bundle — the sparklines
// hydrate after load and the strip renders fine without them.
const SignalSparkline = dynamic(
  () => import('@/components/SignalSparkline').then(m => m.SignalSparkline),
  { ssr: false, loading: () => <div style={{ height: 28 }} /> }
)

export interface MomentumStripItem {
  id: string
  label: string
  momentum: 'rising' | 'stable' | 'declining'
  recentCount: number
  weekly: SparkPoint[]
}

const GLYPH: Record<MomentumStripItem['momentum'], string> = { rising: '↑', stable: '→', declining: '↓' }

export function MomentumStrip({ items }: { items: MomentumStripItem[] }) {
  if (items.length === 0) return null
  return (
    <section className="momentum-strip" aria-label="Signal momentum this week">
      <div className="momentum-strip__head">
        <p className="momentum-strip__title">Signal momentum</p>
        <Link href="/intelligence/signals" className="sidebar-widget__more">All signals →</Link>
      </div>
      <div className="momentum-strip__grid">
        {items.map(item => (
          <Link key={item.id} href={`/intelligence/signals/${item.id}`} className="momentum-strip__item">
            <span className="momentum-strip__label">{item.label}</span>
            <span className="momentum-strip__meta">
              {GLYPH[item.momentum]} {item.momentum} · {item.recentCount} article{item.recentCount !== 1 ? 's' : ''} / 8 wk
            </span>
            <SignalSparkline data={item.weekly} height={28} />
          </Link>
        ))}
      </div>
    </section>
  )
}
