// The rolling window a digest run covers, and the query that resolves it to
// articles. Shared by /api/digest/send and /api/digest/preview so the two
// routes can never disagree about what "the current issue" contains. Unlike
// lib/email/digest.ts this touches the DB, so it stays out of that file.
import { createServiceClient } from '@/lib/supabase/server'

const PERIOD_DAYS = 7

export function currentPeriod() {
  const periodEnd = new Date()
  const periodStart = new Date(periodEnd.getTime() - PERIOD_DAYS * 24 * 60 * 60 * 1000)
  return { periodStart, periodEnd, periodLabel: formatPeriodRange(periodStart, periodEnd) }
}

// "18–25 September 2026", "28 September – 5 October 2026",
// "29 December 2026 – 5 January 2027". Formatted in UTC, the zone the send
// runs in, so the label can't drift a day depending on where it is rendered.
export function formatPeriodRange(start: Date, end: Date): string {
  const day = (d: Date) => d.getUTCDate()
  const month = (d: Date) => d.toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' })
  const year = (d: Date) => d.getUTCFullYear()
  if (year(start) !== year(end)) {
    return `${day(start)} ${month(start)} ${year(start)} – ${day(end)} ${month(end)} ${year(end)}`
  }
  if (month(start) !== month(end)) {
    return `${day(start)} ${month(start)} – ${day(end)} ${month(end)} ${year(end)}`
  }
  return `${day(start)}–${day(end)} ${month(end)} ${year(end)}`
}

export function fetchPeriodArticles(service: ReturnType<typeof createServiceClient>, periodStart: Date) {
  return service
    .from('articles')
    .select('id, title, slug, excerpt, impact_score, signal_ids, business_implications, published_at')
    .eq('article_type', 'industry')
    .gte('published_at', periodStart.toISOString())
    .order('published_at', { ascending: false })
}
