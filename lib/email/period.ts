// The rolling window a digest run covers, and the query that resolves it to
// articles. Shared by /api/digest/send and /api/digest/preview so the two
// routes can never disagree about what "the current issue" contains. Unlike
// lib/email/digest.ts this touches the DB, so it stays out of that file.
import { createServiceClient } from '@/lib/supabase/server'

const PERIOD_DAYS = 7

export function currentPeriod() {
  const periodEnd = new Date()
  const periodStart = new Date(periodEnd.getTime() - PERIOD_DAYS * 24 * 60 * 60 * 1000)
  const periodLabel = `Week of ${periodStart.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}`
  return { periodStart, periodEnd, periodLabel }
}

export function fetchPeriodArticles(service: ReturnType<typeof createServiceClient>, periodStart: Date) {
  return service
    .from('articles')
    .select('id, title, slug, excerpt, impact_score, signal_ids, business_implications, published_at')
    .eq('article_type', 'industry')
    .gte('published_at', periodStart.toISOString())
    .order('published_at', { ascending: false })
}
