import type { Metadata } from 'next'
import { createServiceClient } from '@/lib/supabase/server'
import { LocStockClient } from './LocStockClient'

export const dynamic = 'force-dynamic'
export const revalidate = 3600

export const metadata: Metadata = {
  title: 'LocStock — Localization Market Index',
  description: 'Live equity overview of 39 publicly traded companies with exposure to language services, AI translation, and localization technology.',
  alternates: { canonical: '/compass/locstock' },
}

export default async function LocStockPage() {
  const supabase = createServiceClient()
  const { data } = await supabase
    .from('market_quotes')
    .select('ticker, data, updated_at')

  const quotes: Record<string, unknown> = {}
  let updatedAt = ''
  for (const row of data ?? []) {
    quotes[row.ticker] = row.data
    if (!updatedAt || row.updated_at > updatedAt) updatedAt = row.updated_at
  }

  const staticData = await import('@/assets/data/market_quotes.json')

  // Fallback to static JSON if Supabase table is empty
  if (!Object.keys(quotes).length) {
    return (
      <div className="container" style={{ paddingTop: 'var(--space-8)', paddingBottom: 'var(--space-12)' }}>
        <LocStockClient quotes={staticData.quotes as Record<string, unknown>} updatedAt={staticData.updated_at} />
      </div>
    )
  }

  // Supplement missing history from static JSON (Supabase data pre-dates history tracking)
  const staticQuotes = staticData.quotes as Record<string, { history?: unknown[] }>
  for (const ticker of Object.keys(quotes)) {
    const q = quotes[ticker] as Record<string, unknown>
    if (!q.history && staticQuotes[ticker]?.history) {
      q.history = staticQuotes[ticker].history
    }
  }

  return (
    <div className="container" style={{ paddingTop: 'var(--space-8)', paddingBottom: 'var(--space-12)' }}>
      <LocStockClient quotes={quotes} updatedAt={updatedAt} />
    </div>
  )
}
