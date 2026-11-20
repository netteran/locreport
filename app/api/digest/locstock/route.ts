import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { summarizeMarket } from '@/lib/email/digest'
import { marketSectionMarkdown } from '@/lib/email/edition'
import { currentPeriod } from '@/lib/email/period'
import { weeklyEditionDate } from '@/lib/email/weeklyNote'
import { createServiceClient } from '@/lib/supabase/server'

export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { periodStart, periodEnd } = currentPeriod()
  const { data, error } = await createServiceClient().from('market_quotes').select('ticker, data')
  if (error) return NextResponse.json({ error: 'Could not load LocStock prices.' }, { status: 503 })

  const market = summarizeMarket(data ?? [], periodStart, periodEnd)
  return NextResponse.json({
    editionDate: weeklyEditionDate(periodEnd),
    section: market ? marketSectionMarkdown(market) : null,
  }, { headers: { 'Cache-Control': 'no-store' } })
}
