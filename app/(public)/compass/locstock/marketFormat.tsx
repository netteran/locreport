// Quote formatting + sparkline shared by the LocStock page and the market card
// on Tech Directory profiles (app/(public)/compass/directory/[slug]), so a
// company's price reads the same in both places. No hooks, so it renders on
// the server and inside the LocStock client component alike.

export interface HistoryPoint { date: string; close: number }

export interface Quote {
  price: number
  change: number
  change_pct: number
  prev_close: number
  currency: string
  market_cap: number
  history?: HistoryPoint[]
}

export const COUNTRY_FLAGS: Record<string, string> = {
  US:'🇺🇸', UK:'🇬🇧', CN:'🇨🇳', KR:'🇰🇷', HK:'🇭🇰', SE:'🇸🇪', DE:'🇩🇪',
  FR:'🇫🇷', IN:'🇮🇳', AU:'🇦🇺', NZ:'🇳🇿', JP:'🇯🇵', CA:'🇨🇦', IT:'🇮🇹',
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD:'$', EUR:'€', GBP:'£', GBp:'p', HKD:'HK$', KRW:'₩', JPY:'¥',
  AUD:'A$', CAD:'C$', NZD:'NZ$', CNY:'CN¥',
}

export function formatMCap(v: number): string {
  if (v >= 1e12) return `${(v/1e12).toFixed(1)}T`
  if (v >= 1e9)  return `${(v/1e9).toFixed(1)}B`
  if (v >= 1e6)  return `${(v/1e6).toFixed(1)}M`
  return v.toLocaleString()
}

export function formatPrice(price: number, currency: string): string {
  const sym = CURRENCY_SYMBOLS[currency] ?? currency + ' '
  if (['KRW','JPY'].includes(currency)) return `${sym}${Math.round(price).toLocaleString()}`
  return `${sym}${price.toFixed(2)}`
}

export function quoteDirection(q: Quote | undefined): 'up' | 'down' | 'flat' {
  return !q ? 'flat' : q.change_pct > 0 ? 'up' : q.change_pct < 0 ? 'down' : 'flat'
}

// SVG sparkline from history array
export function Sparkline({ history, dir, width = 80, height = 28 }: { history: HistoryPoint[]; dir: string; width?: number; height?: number }) {
  if (!history || history.length < 2) return null
  const prices = history.map(h => h.close)
  const min = Math.min(...prices)
  const max = Math.max(...prices)
  const range = max - min || 1
  const W = width, H = height
  const points = prices.map((p, i) => {
    const x = (i / (prices.length - 1)) * W
    const y = H - ((p - min) / range) * H
    return `${x},${y}`
  }).join(' ')
  const color = dir === 'up' ? '#16a34a' : dir === 'down' ? '#dc2626' : '#94a3b8'
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="market-sparkline" aria-hidden="true">
      <polyline fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" points={points} />
    </svg>
  )
}
