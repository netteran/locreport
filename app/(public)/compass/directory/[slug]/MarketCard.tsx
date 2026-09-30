import Link from 'next/link'
import { createServiceClient } from '@/lib/supabase/server'
import type { LOCSTOCK_COMPANIES } from '@/lib/data/locstock'
import { COUNTRY_FLAGS, Sparkline, formatMCap, formatPrice, quoteDirection, type Quote } from '../../locstock/marketFormat'

type LocStockCompany = (typeof LOCSTOCK_COMPANIES)[number]

// The company's latest cached quote: the market_quotes row /api/market-quotes
// refreshes (service role — the table has no public policy), falling back to
// the bundled snapshot LocStock also falls back to. Decorative, so any failure
// yields null and the card says prices aren't available rather than breaking
// the profile.
async function getQuote(ticker: string): Promise<{ quote: Quote; updatedAt: string | null } | null> {
  try {
    const { data } = await createServiceClient()
      .from('market_quotes')
      .select('data, updated_at')
      .eq('ticker', ticker)
      .maybeSingle()
    if (data?.data) return { quote: data.data as Quote, updatedAt: data.updated_at ?? null }
  } catch {}
  try {
    const snapshot = await import('@/assets/data/market_quotes.json')
    const q = (snapshot.quotes as Record<string, unknown>)[ticker]
    if (q) return { quote: q as Quote, updatedAt: snapshot.updated_at }
  } catch {}
  return null
}

export async function MarketCard({ company }: { company: LocStockCompany }) {
  const result = await getQuote(company.t)
  const q = result?.quote
  const dir = quoteDirection(q)
  const warn = 'warn' in company ? company.warn : undefined
  // A year of daily closes reads better than the full history at this width.
  const history = q?.history?.slice(-260)

  const updated = result?.updatedAt
    ? new Date(result.updatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    : null

  // A square tile the same size as the logo beside it.
  return (
    <section className={`dir-market-card ${dir}`} aria-label={`${company.n} share price`}>
      <div className="dir-market-top">
        <span className="dir-market-ticker">{company.s}</span>
        <span className="dir-market-exchange" title={company.n}>
          {COUNTRY_FLAGS[company.co] ?? company.co} {company.ex}
        </span>
      </div>
      {q ? (
        <>
          <div className="dir-market-price" title={updated ? `Last updated ${updated}` : undefined}>
            <span className="dir-market-price-value">{formatPrice(q.price, q.currency)}</span>
            <span className={`market-card-change ${dir}`}>
              {q.change_pct >= 0 ? '+' : ''}{q.change_pct.toFixed(2)}%
            </span>
          </div>
          {history && history.length > 1 && (
            <Sparkline history={history} dir={dir} width={158} height={30} />
          )}
          {q.market_cap > 0 && (
            <span className="dir-market-mcap">Mkt cap {formatMCap(q.market_cap)}</span>
          )}
        </>
      ) : (
        <p className="dir-market-empty">Price data isn’t available yet.</p>
      )}
      {warn && <span className="dir-market-warn">{warn}</span>}
      <Link href="/compass/locstock" className="dir-market-link">LocStock →</Link>
    </section>
  )
}
