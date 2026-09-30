import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import YahooFinanceClass from 'yahoo-finance2'
const yahooFinance = new YahooFinanceClass()

export const maxDuration = 60

interface YFQuote {
  regularMarketPrice?: number
  regularMarketChange?: number
  regularMarketChangePercent?: number
  regularMarketPreviousClose?: number
  currency?: string
  marketCap?: number
}

interface YFChartBar {
  date: Date
  close?: number | null
}

interface YFChart {
  quotes?: YFChartBar[]
}

const TICKERS = [
  'NVDA','GOOGL','MSFT','META','AMZN','NFLX','DUOL','RWS.L',
  'SOUN','AI','BIDU','035420.KS','0700.HK','BABA','SPOT','ADBE','ORCL',
  'SAP','IBM','TEP.PA','AMN','TASK','INFY','WIT','CNXC','ZOO.L','APX.AX',
  'AIM.AX','AGT.AX','2483.T','6182.T','7812.T','300080.KQ','VQS.V',
  'ONEI','STAR7.MI','301236.SZ','002230.SZ',
]

export async function POST(req: NextRequest) {
  const auth = req.headers.get('Authorization')
  const isCron = auth === `Bearer ${process.env.CRON_SECRET}`

  if (!isCron) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user || user.email !== process.env.ADMIN_EMAIL) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const service = createServiceClient()
  const now = new Date()
  const historyStart = new Date('2024-01-01')

  let updated = 0
  let failed = 0
  const details: Record<string, { history: number } | { error: string }> = {}

  await Promise.all(TICKERS.map(async (ticker) => {
    try {
      const [quote, chart] = await Promise.all([
        yahooFinance.quote(ticker) as Promise<unknown>,
        yahooFinance.chart(ticker, {
          period1: historyStart,
          interval: '1d',
        }),
      ])

      const q = quote as YFQuote
      const c = chart as unknown as YFChart

      if (!q.regularMarketPrice) throw new Error('No price data')

      const history = (c.quotes ?? [])
        .filter(b => b.close != null)
        .map(b => ({ date: new Date(b.date).toISOString().slice(0, 10), close: b.close as number }))
        .sort((a, b) => a.date.localeCompare(b.date))

      const data = {
        price:      q.regularMarketPrice,
        change:     q.regularMarketChange ?? 0,
        change_pct: q.regularMarketChangePercent ?? 0,
        prev_close: q.regularMarketPreviousClose ?? 0,
        currency:   q.currency ?? 'USD',
        market_cap: q.marketCap ?? 0,
        history,
      }

      await service.from('market_quotes').upsert(
        { ticker, data, updated_at: now.toISOString() },
        { onConflict: 'ticker' }
      )
      details[ticker] = { history: history.length }
      updated++
    } catch (err) {
      const msg = err instanceof Error ? `${err.message}\n${err.stack}` : String(err)
      console.error(`[market-quotes] failed ${ticker}:`, msg)
      details[ticker] = { error: String(err) }
      failed++
    }
  }))

  return NextResponse.json({ updated, failed, total: TICKERS.length, details })
}

export async function GET() {
  const service = createServiceClient()
  const { data, error } = await service
    .from('market_quotes')
    .select('ticker, data, updated_at')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const quotes: Record<string, unknown> = {}
  let updatedAt = ''
  for (const row of data ?? []) {
    quotes[row.ticker] = row.data
    if (!updatedAt || row.updated_at > updatedAt) updatedAt = row.updated_at
  }
  return NextResponse.json({ quotes, updated_at: updatedAt })
}
