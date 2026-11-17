import type { SupabaseClient } from '@supabase/supabase-js'
import { marked } from 'marked'

/** Inclusive calendar dates follow the editorial timezone, including DST. */
function warsawMidnight(date: string) {
  const utc = Date.parse(`${date}T00:00:00Z`)
  const zone = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Warsaw', timeZoneName: 'shortOffset' })
    .formatToParts(utc).find(p => p.type === 'timeZoneName')!.value
  const offset = Number(zone.match(/GMT\+(\d+)/)?.[1] || 0)
  return new Date(utc - offset * 3600000).toISOString()
}

export function reportPeriod(start: unknown, end: unknown) {
  for (const date of [start, end]) {
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date || date < '1900-01-01' || date > '9998-12-31') {
      throw new Error('Choose valid start and end dates (YYYY-MM-DD).')
    }
  }
  const startDay = start as string, endDay = end as string
  if (startDay > endDay) throw new Error('The end date must be on or after the start date.')
  const nextDay = new Date(Date.parse(endDay) + 86400000).toISOString().slice(0, 10)
  const year = Number(startDay.slice(0, 4)), month = Number(startDay.slice(5, 7))
  const period = startDay.slice(0, 7)
  const fullMonth = startDay.endsWith('-01') && nextDay.endsWith('-01') && endDay.startsWith(period)
  const monthName = new Date(`${startDay}T12:00:00Z`).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' })
  return { period, year, month, monthName, startDay, endDay, fullMonth,
    label: fullMonth ? `${monthName} ${year}` : `${startDay} to ${endDay}`,
    key: fullMonth ? period : `${startDay}-to-${endDay}`,
    startDate: warsawMidnight(startDay), endDate: warsawMidnight(nextDay) }
}

/** Default to the previous complete editorial calendar month. */
export function monthlyPeriod(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Warsaw', year: 'numeric', month: 'numeric' }).formatToParts(now)
  const year = Number(parts.find(p => p.type === 'year')!.value)
  const month = Number(parts.find(p => p.type === 'month')!.value)
  return reportPeriod(new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 10),
    new Date(Date.UTC(year, month - 1, 0)).toISOString().slice(0, 10))
}

function checked<T>(result: { data: T; error: { message: string } | null }, label: string): T {
  if (result.error) throw new Error(`Could not load monthly ${label}: ${result.error.message}`)
  return result.data
}

export async function loadMonthlyEvidence(service: SupabaseClient, period: ReturnType<typeof monthlyPeriod>) {
  const { startDate, endDate } = period
  const results = await Promise.all([
    service.from('articles').select('id,title,source_url,publisher,excerpt,content,slug,published_at')
      .eq('article_type', 'industry').gte('published_at', startDate).lt('published_at', endDate)
      .order('published_at', { ascending: false }).limit(60),
    service.from('facts').select('id,content,source_url,source_name,event_id,published_at,review_reason')
      .eq('status', 'published').gte('published_at', startDate).lt('published_at', endDate)
      .order('published_at', { ascending: false }).limit(200),
    service.from('source_candidates').select('id,title,source_url,source_name,source_published_at,created_at,extracted_facts,quality,event_id,review_reason')
      .in('status', ['available', 'reserved', 'used']).eq('processing_status', 'ready')
      .gte('source_published_at', startDate).lt('source_published_at', endDate)
      .order('source_published_at', { ascending: false }).limit(120),
    service.from('source_candidates').select('id,title,source_url,source_name,source_published_at,created_at,extracted_facts,quality,event_id,review_reason')
      .in('status', ['available', 'reserved', 'used']).eq('processing_status', 'ready')
      .is('source_published_at', null).gte('created_at', startDate).lt('created_at', endDate)
      .order('created_at', { ascending: false }).limit(30),
    service.from('articles').select('title,content,slug,published_at')
      .eq('article_type', 'monthly-summary')
      .or(`report_end_date.lt.${period.startDay},and(report_end_date.is.null,monthly_period.lt.${period.period}),and(report_end_date.is.null,monthly_period.is.null,published_at.lt.${startDate})`)
      .order('report_end_date', { ascending: false, nullsFirst: false }).order('monthly_period', { ascending: false, nullsFirst: false }).order('published_at', { ascending: false }).limit(1)
  ])
  const articles = checked(results[0], 'articles') || []
  const facts = checked(results[1], 'published facts') || []
  const sources = [...(checked(results[2], 'dated sources') || []), ...(checked(results[3], 'undated sources') || [])]
  const previous = (checked(results[4], 'previous briefing') || [])[0] || null
  const link = (slug: string) => `/articles/${slug}`
  // Independent section budgets leave room for facts even when article bodies are long.
  function bounded<T, U>(rows: T[], budget: number, transform: (row: T) => U) {
    const items: U[] = []
    for (const row of rows) {
      const item = transform(row), size = JSON.stringify(item).length
      if (size > budget) break
      items.push(item); budget -= size
    }
    return items
  }
  const context = {
    period: period.period,
    date_range: { start: period.startDay, end: period.endDay, timezone: 'Europe/Warsaw', end_inclusive: true },
    coverage_note: 'A bounded selection of collected evidence, not exhaustive industry coverage. Publication dates establish reporting timing, not necessarily event timing. Undated sources are context only.',
    articles: bounded(articles, 40000, a => ({ title: a.title, publisher: a.publisher, source_url: a.source_url, url: link(a.slug),
      published_at: a.published_at, analysis: (a.content || a.excerpt || '').slice(0, 5000) })),
    published_facts: bounded(facts, 30000, f => ({ ...f, content: f.content.slice(0, 900) })),
    source_evidence: bounded(sources, 70000, s => ({ ...s, extracted_facts: s.extracted_facts.slice(0, 2500),
      evidence_status: 'Collected source evidence, not independently verified. Preserve review flags and source attribution.',
      timing: s.source_published_at ? 'Reported during the selected period; verify the event date in the evidence.' : 'Undated source collected during the selected period; background only, not evidence of a new development in the selected period.' })),
    previous_briefing: previous ? { title: previous.title, url: link(previous.slug), published_at: previous.published_at,
      content: previous.content.slice(0, 20000), role: 'Compare expectations only; not new evidence for the selected period.' } : null,
    limits: { articles: 60, published_facts: 200, dated_sources: 120, undated_sources: 30, text_budget_characters: 160000 }
  }
  const allowedUrls = new Set<string>()
  for (const a of context.articles) { allowedUrls.add(a.url); if (a.source_url) allowedUrls.add(a.source_url) }
  for (const f of context.published_facts) if (f.source_url) allowedUrls.add(f.source_url)
  for (const s of context.source_evidence) if (s.source_url) allowedUrls.add(s.source_url)
  if (previous) allowedUrls.add(link(previous.slug))
  return { context, allowedUrls,
    hasCurrentEvidence: !!(context.articles.length || context.published_facts.length || context.source_evidence.some(s => s.source_published_at)),
    counts: { articles: context.articles.length, facts: context.published_facts.length, sources: context.source_evidence.length } }
}

/** Match document URLs without treating tracking or on-page anchors as new sources. */
function citationIdentity(raw: string): string | null {
  try {
    const url = new URL(raw.replace(/&amp;/g, '&'), 'https://locreport.com')
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null
    // Relative paths are only meaningful for our own published articles.
    if (!/^https?:\/\//i.test(raw) && !raw.startsWith('/articles/')) return null
    url.hash = ''
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_|^(fbclid|gclid|mc_cid|mc_eid)$/i.test(key)) url.searchParams.delete(key)
    }
    url.searchParams.sort()
    url.pathname = url.pathname.replace(/\/$/, '') || '/'
    if (['locreport.com', 'www.locreport.com'].includes(url.hostname) && !url.port) {
      url.hostname = 'locreport.com'
      url.protocol = 'https:'
    }
    return url.toString()
  } catch { return null }
}

export class BriefingCitationError extends Error {
  constructor(public readonly unsupportedUrls: string[]) {
    super(unsupportedUrls.length
      ? `Monthly briefing cites a URL outside the supplied evidence: ${unsupportedUrls.slice(0, 5).join(', ')}; nothing was published. Retry generation to repair the citations.`
      : 'Monthly briefing omitted evidence links; nothing was published. Retry generation to repair the citations.')
    this.name = 'BriefingCitationError'
  }
}

export function validateBriefing(content: string, allowedUrls: Set<string>) {
  if (!content.trim() || !/^#\s+\S/m.test(content)) throw new Error('Monthly briefing returned empty or malformed content; nothing was published.')
  const allowed = new Set([...allowedUrls].map(citationIdentity).filter((url): url is string => !!url))
  const unsupported = new Set<string>()
  let cited = false
  // Use the same Markdown parser as published articles, including references,
  // autolinks and URLs containing parentheses. A regex truncates these URLs.
  marked.walkTokens(marked.lexer(content), token => {
    if (token.type !== 'link') return
    // Table-of-contents anchors are navigation, not evidence citations.
    if (token.href.startsWith('#')) return
    const identity = citationIdentity(token.href)
    if (!identity || !allowed.has(identity)) unsupported.add(token.href)
    else cited = true
  })
  if (unsupported.size) throw new BriefingCitationError([...unsupported])
  if (!cited) throw new BriefingCitationError([])
}
