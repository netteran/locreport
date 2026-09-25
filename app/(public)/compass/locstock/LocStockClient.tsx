'use client'
import { useState } from 'react'
import dynamic from 'next/dynamic'
import { LOCSTOCK_COMPANIES as COMPANIES } from '@/lib/data/locstock'

const LocStockChart = dynamic(
  () => import('./LocStockChart').then(m => ({ default: m.LocStockChart })),
  { ssr: false, loading: () => <div className="market-chart-section" style={{height:60,display:'flex',alignItems:'center',justifyContent:'center'}}><span style={{fontSize:'0.82rem',color:'var(--muted)'}}>Loading chart…</span></div> }
)

interface HistoryPoint { date: string; close: number }

interface Quote {
  price: number
  change: number
  change_pct: number
  prev_close: number
  currency: string
  market_cap: number
  history?: HistoryPoint[]
}

interface Props {
  quotes: Record<string, unknown>
  updatedAt: string
}


// Featured tickers shown in the performance chart

const CAT_LABELS: Record<string, string> = {
  all:'All', aiplatform:'AI Platform', bigtech:'Big Tech',
  media:'Media', learning:'Learning', lsp:'Language Services',
  enterprise:'Enterprise SW', bpo:'BPO & Staffing', aidata:'AI & Data',
}

const COUNTRY_FLAGS: Record<string, string> = {
  US:'🇺🇸', UK:'🇬🇧', CN:'🇨🇳', KR:'🇰🇷', HK:'🇭🇰', SE:'🇸🇪', DE:'🇩🇪',
  FR:'🇫🇷', IN:'🇮🇳', AU:'🇦🇺', NZ:'🇳🇿', JP:'🇯🇵', CA:'🇨🇦', IT:'🇮🇹',
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD:'$', EUR:'€', GBP:'£', GBp:'p', HKD:'HK$', KRW:'₩', JPY:'¥',
  AUD:'A$', CAD:'C$', NZD:'NZ$', CNY:'CN¥',
}

const DELISTED = [
  { ticker:'KWS',  name:'Keywords Studios',    ex:'LSE AIM',  reason:'Acquired by EQT Partners (private equity), 2024' },
  { ticker:'TIXT', name:'TELUS International', ex:'NYSE/TSX', reason:'Taken private by TELUS Corp, 2024' },
  { ticker:'STIX', name:'Semantix',            ex:'NASDAQ',   reason:'Merged / delisted 2023' },
  { ticker:'SDL',  name:'SDL plc',             ex:'LSE',      reason:'Acquired by RWS Holdings, 2021' },
  { ticker:'LBI',  name:'Lionbridge',          ex:'NASDAQ',   reason:'Taken private by H.I.G. Capital, 2017' },
  { ticker:'SUL',  name:'Summa Linguae',       ex:'WSE',      reason:'Delisted from Warsaw Stock Exchange' },
]

function formatMCap(v: number): string {
  if (v >= 1e12) return `${(v/1e12).toFixed(1)}T`
  if (v >= 1e9)  return `${(v/1e9).toFixed(1)}B`
  if (v >= 1e6)  return `${(v/1e6).toFixed(1)}M`
  return v.toLocaleString()
}

function formatPrice(price: number, currency: string): string {
  const sym = CURRENCY_SYMBOLS[currency] ?? currency + ' '
  if (['KRW','JPY'].includes(currency)) return `${sym}${Math.round(price).toLocaleString()}`
  return `${sym}${price.toFixed(2)}`
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day:'numeric', month:'short', year:'numeric',
    hour:'2-digit', minute:'2-digit', timeZoneName:'short',
  })
}

// SVG sparkline from history array
function Sparkline({ history, dir }: { history: HistoryPoint[]; dir: string }) {
  if (!history || history.length < 2) return null
  const prices = history.map(h => h.close)
  const min = Math.min(...prices)
  const max = Math.max(...prices)
  const range = max - min || 1
  const W = 80, H = 28
  const points = prices.map((p, i) => {
    const x = (i / (prices.length - 1)) * W
    const y = H - ((p - min) / range) * H
    return `${x},${y}`
  }).join(' ')
  const color = dir === 'up' ? '#16a34a' : dir === 'down' ? '#dc2626' : '#94a3b8'
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="market-sparkline">
      <polyline fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" points={points} />
    </svg>
  )
}


export function LocStockClient({ quotes, updatedAt }: Props) {
  const [activeFilter, setActiveFilter] = useState<string>('all')

  const cats = Object.keys(CAT_LABELS)
  const catCounts = cats.reduce<Record<string,number>>((acc, cat) => {
    acc[cat] = cat === 'all' ? COMPANIES.length : COMPANIES.filter(c => c.cat === cat).length
    return acc
  }, {})

  const filtered = activeFilter === 'all' ? [...COMPANIES] : COMPANIES.filter(c => c.cat === activeFilter)

  let gainers = 0, decliners = 0, unchanged = 0
  for (const c of COMPANIES) {
    const q = quotes[c.t] as Quote | undefined
    if (!q) continue
    if (q.change_pct > 0) gainers++
    else if (q.change_pct < 0) decliners++
    else unchanged++
  }

  return (
    <>
      <div className="market-hero">
        <h1>LocStock</h1>
        <p className="market-subtitle">
          Live equity overview of 38 publicly traded companies with exposure to language services,
          AI translation, and localization technology across 14 global exchanges.
        </p>
      </div>

      <div className="market-stats-bar">
        <div className="market-stat">
          <span className="market-stat-value up">{gainers}</span>
          <span className="market-stat-label">Gainers</span>
        </div>
        <div className="market-stat">
          <span className="market-stat-value down">{decliners}</span>
          <span className="market-stat-label">Decliners</span>
        </div>
        <div className="market-stat">
          <span className="market-stat-value">{unchanged}</span>
          <span className="market-stat-label">Unchanged</span>
        </div>
        <div className="market-stat">
          <span className="market-stat-value">{COMPANIES.length}</span>
          <span className="market-stat-label">Companies</span>
        </div>
      </div>

      {/* Performance chart — dynamically loaded, no SSR */}
      <LocStockChart quotes={quotes} tickers={filtered.map(c => c.t)} />

      <div className="market-filters">
        {cats.map(cat => (
          <button
            key={cat}
            className={`market-filter-btn${activeFilter === cat ? ' active' : ''}`}
            onClick={() => setActiveFilter(cat)}
          >
            {CAT_LABELS[cat]}
            <span className="market-filter-count">{catCounts[cat]}</span>
          </button>
        ))}
      </div>

      <div className="market-updated">
        Updated: {updatedAt ? fmtDate(updatedAt) : '—'}
      </div>

      <div className="market-mosaic">
        {filtered.map(co => {
          const q = quotes[co.t] as Quote | undefined
          const dir = !q ? 'flat' : q.change_pct > 0 ? 'up' : q.change_pct < 0 ? 'down' : 'flat'
          const isFeatured = 'ft' in co && co.ft
          const warn = 'warn' in co ? co.warn : undefined
          return (
            <div key={co.t} className={`market-card ${dir}${isFeatured ? ' featured' : ''}`}>
              <div className="market-card-ticker">{co.s}</div>
              <div className="market-card-name">{co.n}</div>
              {q ? (
                <>
                  <div className="market-card-price">{formatPrice(q.price, q.currency)}</div>
                  <div className={`market-card-change ${dir}`}>
                    {q.change_pct >= 0 ? '+' : ''}{q.change_pct.toFixed(2)}%
                    {' '}({q.change >= 0 ? '+' : ''}{q.change.toFixed(2)})
                  </div>
                  {q.history && q.history.length > 1 && (
                    <Sparkline history={q.history} dir={dir} />
                  )}
                  <div className="market-card-mcap">{formatMCap(q.market_cap)}</div>
                </>
              ) : (
                <div className="market-card-change flat">No data</div>
              )}
              <div className="market-card-meta">
                {COUNTRY_FLAGS[co.co] ?? co.co} {co.ex}
                {warn && <span style={{ marginLeft: 4 }}>{warn}</span>}
              </div>
            </div>
          )
        })}
      </div>

      <div className="market-delisted-section">
        <div className="market-delisted-title">Delisted / Former listings</div>
        <div className="market-delisted-grid">
          {DELISTED.map(d => (
            <div key={d.ticker} className="market-delisted-card">
              <div className="market-delisted-ticker">{d.ticker}</div>
              <div className="market-delisted-name">{d.name}</div>
              <div className="market-delisted-meta">{d.ex}</div>
              <div className="market-delisted-reason">{d.reason}</div>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
