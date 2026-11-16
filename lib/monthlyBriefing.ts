import type { SupabaseClient } from '@supabase/supabase-js'

/** Calendar months follow the editorial timezone, including CET/CEST boundaries. */
export function monthlyPeriod(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Warsaw', year: 'numeric', month: 'numeric' }).formatToParts(now)
  const currentYear = Number(parts.find(p => p.type === 'year')!.value)
  const currentMonth = Number(parts.find(p => p.type === 'month')!.value)
  const previous = new Date(Date.UTC(currentYear, currentMonth - 2, 1))
  const year = previous.getUTCFullYear(), month = previous.getUTCMonth() + 1
  function boundary(y: number, m: number) {
    const utc = Date.UTC(y, m, 1)
    const zone = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Warsaw', timeZoneName: 'shortOffset' })
      .formatToParts(utc).find(p => p.type === 'timeZoneName')!.value
    const offset = Number(zone.match(/GMT\+(\d+)/)?.[1] || 0)
    return new Date(utc - offset * 3600000).toISOString()
  }
  return {
    period: `${year}-${String(month).padStart(2, '0')}`, year, month,
    monthName: previous.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' }),
    startDate: boundary(year, month - 1), endDate: boundary(year, month)
  }
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
      .eq('article_type', 'monthly-summary').lte('published_at', startDate)
      .order('published_at', { ascending: false }).limit(1)
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
    coverage_note: 'A bounded selection of collected evidence, not exhaustive industry coverage. Publication dates establish reporting timing, not necessarily event timing. Undated sources are context only.',
    articles: bounded(articles, 40000, a => ({ title: a.title, publisher: a.publisher, source_url: a.source_url, url: link(a.slug),
      published_at: a.published_at, analysis: (a.content || a.excerpt || '').slice(0, 5000) })),
    published_facts: bounded(facts, 30000, f => ({ ...f, content: f.content.slice(0, 900) })),
    source_evidence: bounded(sources, 70000, s => ({ ...s, extracted_facts: s.extracted_facts.slice(0, 2500),
      evidence_status: 'Collected source evidence, not independently verified. Preserve review flags and source attribution.',
      timing: s.source_published_at ? 'Reported during the target month; verify the event date in the evidence.' : 'Undated source collected during the month; background only, not evidence of a new monthly development.' })),
    previous_briefing: previous ? { title: previous.title, url: link(previous.slug), published_at: previous.published_at,
      content: previous.content.slice(0, 20000), role: 'Compare expectations only; not new evidence for the target month.' } : null,
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

export function validateBriefing(content: string, allowedUrls: Set<string>) {
  if (!content.trim() || !/^#\s+\S/m.test(content)) throw new Error('Monthly briefing returned empty or malformed content; nothing was published.')
  let cited = false
  for (const match of content.matchAll(/\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
    cited = true
    if (!allowedUrls.has(match[1])) throw new Error('Monthly briefing cites a URL outside the supplied evidence; nothing was published.')
  }
  if (!cited) throw new Error('Monthly briefing omitted evidence links; nothing was published.')
}
