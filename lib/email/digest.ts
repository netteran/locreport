// Issue composition for The Weekly: turns the period's articles, facts, market
// quotes and directory additions into the blocks digestEmail() renders. Pure —
// no DB, no Resend — so it can be exercised on its own. lib/email/issue.ts
// does the fetching.
//
// Every subscriber receives the same issue. There are no per-subscriber
// preferences any more: the signal picker, the summary toggle and the impact
// floor were removed so nobody silently misses part of the week.
import { SIGNALS } from '@/lib/signals'
import { signalShortLabel } from '@/lib/intelligence'
import { LOCSTOCK_COMPANIES } from '@/lib/data/locstock'
import { DIRECTORY_CATEGORIES, type DirectoryEntry } from '@/lib/data/directory'
import { articleHref, splitSentences } from '@/lib/utils'
import type {
  DigestArticle,
  DigestCompany,
  DigestDirectoryEntry,
  DigestFact,
  DigestMarket,
  DigestSignalMove,
} from '@/lib/email/templates'
import { SITE_URL } from '@/lib/email/send'

export interface DigestSourceArticle {
  id: string
  title: string
  slug: string
  excerpt: string | null
  impact_score: number | null
  signal_ids: string[] | null
  business_implications: string[] | null
  published_at: string
}

/** Weeks of history a signal's movement is measured against. */
export const SIGNAL_BASELINE_WEEKS = 4
/** Articles listed in "Everything else" before it hands off to the site. */
const MORE_LIMIT = 40
/** Facts carried in the Fact Flow block. */
const FACT_LIMIT = 5

/** The market brief only runs when the week actually moved. */
const MARKET_AVG_THRESHOLD = 3 // % equal-weighted average move
const MARKET_MOVER_THRESHOLD = 8 // % single-ticker move
const MARKET_MOVERS_SHOWN = 3

export function toDigestArticle(a: DigestSourceArticle): DigestArticle {
  return {
    id: a.id,
    title: a.title,
    url: `${SITE_URL}${articleHref(a.slug)}`,
    excerpt: a.excerpt,
    impact_score: a.impact_score,
    business_implications: a.business_implications,
  }
}

function byImpact(a: DigestSourceArticle, b: DigestSourceArticle) {
  return (b.impact_score ?? 0) - (a.impact_score ?? 0) || b.published_at.localeCompare(a.published_at)
}

// How each of the 13 signals moved this week against its average over the
// previous SIGNAL_BASELINE_WEEKS weeks. Every signal gets a row, so a signal
// that went quiet is reported as plainly as one that surged.
export function computeSignalMoves(
  period: DigestSourceArticle[],
  prior: Pick<DigestSourceArticle, 'signal_ids'>[],
  topStoryId: string | null
): DigestSignalMove[] {
  const moves = SIGNALS.map(s => {
    const tagged = period.filter(a => (a.signal_ids ?? []).includes(s.id)).sort(byImpact)
    const priorCount = prior.filter(a => (a.signal_ids ?? []).includes(s.id)).length
    const priorAvg = priorCount / SIGNAL_BASELINE_WEEKS
    const count = tagged.length

    let trend: DigestSignalMove['trend']
    if (count === 0) trend = 'quiet'
    else if (priorCount === 0) trend = 'new'
    else if (count >= priorAvg * 1.5 && count - priorAvg >= 1) trend = 'up'
    else if (count <= priorAvg * 0.5 && priorAvg - count >= 1) trend = 'down'
    else trend = 'steady'

    // Lead with something the reader hasn't just seen as the top story, when
    // the signal has anything else to offer.
    const lead = tagged.find(a => a.id !== topStoryId) ?? tagged[0] ?? null

    return {
      id: s.id,
      label: signalShortLabel(s.id),
      url: `${SITE_URL}/intelligence/signals/${s.id}`,
      count,
      priorAvg: Math.round(priorAvg * 10) / 10,
      trend,
      wasActive: priorAvg >= 1,
      lead: lead ? toDigestArticle(lead) : null,
    }
  })
  return moves.sort((a, b) => b.count - a.count || b.priorAvg - a.priorAvg)
}

interface QuoteRow {
  ticker: string
  data: { history?: { date: string; close: number }[] } | null
}

// Equal-weighted week-on-week move across LocStock plus the biggest single
// movers. Returns null — and the email skips the block — unless the week was
// significant, or the quotes are too stale to describe it.
export function summarizeMarket(rows: QuoteRow[], periodStart: Date, periodEnd: Date): DigestMarket | null {
  const startDay = periodStart.toISOString().slice(0, 10)
  const endDay = periodEnd.toISOString().slice(0, 10)
  const names = new Map<string, { s: string; n: string }>(LOCSTOCK_COMPANIES.map(c => [c.t, { s: c.s, n: c.n }]))

  const moves: { symbol: string; name: string; pct: number }[] = []
  for (const row of rows) {
    const history = row.data?.history ?? []
    const upTo = (day: string) => {
      let found: { date: string; close: number } | null = null
      for (const p of history) if (p.date <= day) found = p
      return found
    }
    const start = upTo(startDay)
    const end = upTo(endDay)
    // No close inside the period means the quote is stale; no start means no baseline.
    if (!start || !end || end.date <= startDay || !start.close) continue
    const meta = names.get(row.ticker)
    moves.push({
      symbol: meta?.s ?? row.ticker,
      name: meta?.n ?? row.ticker,
      pct: (end.close / start.close - 1) * 100,
    })
  }
  if (moves.length === 0) return null

  const avgPct = moves.reduce((sum, m) => sum + m.pct, 0) / moves.length
  const bigMovers = moves.filter(m => Math.abs(m.pct) >= MARKET_MOVER_THRESHOLD)
  if (Math.abs(avgPct) < MARKET_AVG_THRESHOLD && bigMovers.length === 0) return null

  const movers = [...moves]
    .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct))
    .slice(0, MARKET_MOVERS_SHOWN)
  return { avgPct, tracked: moves.length, movers, url: `${SITE_URL}/compass/locstock` }
}

// Monday-based week key ("2026-W39"-style, but any stable string will do), so
// a preview opened Monday–Friday shows the same company Friday's send does.
function isoWeekKey(d: Date): string {
  const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7))
  return day.toISOString().slice(0, 10)
}

// FNV-1a: a small, stable string hash — enough to shuffle companies per week.
function hash(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

// Email clients render PNG/JPEG/GIF reliably; SVG, AVIF and (in Outlook) WebP
// break, so only those three count as a usable logo in the email.
function emailSafeLogo(url: string | null | undefined): string | null {
  if (!url || !/^https:\/\//i.test(url)) return null
  return /\.(png|jpe?g|gif)(\?|#|$)/i.test(url) ? url : null
}

// Two or three sentences of what the company does, from the long description
// when there is one.
function companyBlurb(entry: DirectoryEntry): string {
  const source = (entry.long_description || entry.description || '').trim()
  const sentences = splitSentences(source)
  let blurb = ''
  for (const [i, sentence] of sentences.entries()) {
    const next = blurb ? `${blurb} ${sentence}` : sentence
    if (i >= 3 || (i >= 2 && next.length > 420)) break
    blurb = next
  }
  return blurb || entry.description || ''
}

// A pseudo-random directory company for the week: each company's hash with
// the week key decides, so the pick changes every week, is identical for
// every subscriber and for the admin preview, and doesn't shift when a
// company is added mid-week unless the newcomer happens to win. Companies
// with a logo the email can show are preferred.
export function pickCompanyOfWeek(entries: DirectoryEntry[], periodEnd: Date): DigestCompany | null {
  const described = entries.filter(e => e.slug && (e.long_description || e.description))
  if (described.length === 0) return null
  const withLogo = described.filter(e => emailSafeLogo(e.logo_url))
  const pool = withLogo.length > 0 ? withLogo : described
  const week = isoWeekKey(periodEnd)
  const pick = pool.reduce((best, e) => (hash(`${e.slug}:${week}`) < hash(`${best.slug}:${week}`) ? e : best))
  return {
    name: pick.name,
    url: `${SITE_URL}/compass/directory/${pick.slug}`,
    logoUrl: emailSafeLogo(pick.logo_url),
    category: DIRECTORY_CATEGORIES.find(c => c.value === pick.category)?.label ?? null,
    hq: pick.hq || null,
    founded: pick.founded || null,
    blurb: companyBlurb(pick),
  }
}

export interface IssueInput {
  articles: DigestSourceArticle[]
  priorArticles: Pick<DigestSourceArticle, 'signal_ids'>[]
  facts: { content: string; article_id: string }[]
  market: DigestMarket | null
  company: DigestCompany | null
  directory: { name: string; slug: string; category: string | null; description: string | null }[]
}

export interface Issue {
  /** Articles published in the period. */
  storyCount: number
  topStory: DigestArticle | null
  company: DigestCompany | null
  signalMoves: DigestSignalMove[]
  facts: DigestFact[]
  market: DigestMarket | null
  directory: DigestDirectoryEntry[]
  more: DigestArticle[]
  moreCount: number
  /** Every article the issue links, for digest_sends.article_ids. */
  articleIds: string[]
}

export function composeIssue({ articles, priorArticles, facts, market, company, directory }: IssueInput): Issue {
  const ranked = [...articles].sort(byImpact)
  const top = ranked[0] ?? null
  const signalMoves = computeSignalMoves(ranked, priorArticles, top?.id ?? null)

  // One fact per article is the Fact Flow guarantee; take the facts belonging
  // to the week's highest-impact stories.
  const rank = new Map(ranked.map((a, i) => [a.id, i]))
  const factArticles = new Map(ranked.map(a => [a.id, a]))
  const seen = new Set<string>()
  const digestFacts: DigestFact[] = facts
    .filter(f => rank.has(f.article_id))
    .sort((a, b) => rank.get(a.article_id)! - rank.get(b.article_id)!)
    .filter(f => (seen.has(f.article_id) ? false : (seen.add(f.article_id), true)))
    .slice(0, FACT_LIMIT)
    .map(f => ({ content: f.content, url: toDigestArticle(factArticles.get(f.article_id)!).url }))

  const rest = ranked.filter(a => a.id !== top?.id)
  const more = rest.slice(0, MORE_LIMIT)

  const linked = new Set<string>()
  if (top) linked.add(top.id)
  for (const m of signalMoves) if (m.lead) linked.add(m.lead.id)
  for (const a of more) linked.add(a.id)

  return {
    storyCount: ranked.length,
    topStory: top ? toDigestArticle(top) : null,
    company,
    signalMoves,
    facts: digestFacts,
    market,
    directory: directory.map(d => ({
      name: d.name,
      category: d.category,
      description: d.description,
      url: `${SITE_URL}/compass/directory/${d.slug}`,
    })),
    more: more.map(toDigestArticle),
    moreCount: rest.length - more.length,
    articleIds: [...linked],
  }
}
