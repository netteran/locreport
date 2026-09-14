import * as cheerio from 'cheerio'
import type { Cheerio, CheerioAPI } from 'cheerio'
import type { AnyNode } from 'domhandler'
import { escapeXml } from '@/lib/utils'
import { feedUrl } from '@/lib/feedUrl'
import type { ContentFilter, ScrapedSource } from '@/lib/types'

// Ported from aparasion/rss-generator's generate.js. Two simplifications vs.
// the original, both a consequence of running a few times a day rather than
// hourly (it is invoked by ingest.yml immediately before each ingest run): no
// ETag/Last-Modified 304 short-circuit on the listing page itself (a hours-old
// page is worth re-parsing regardless), and no retry/backoff/429 handling (a
// single fetch with a timeout, matching lib/rss.ts's existing fetch helpers). The per-article relevance memo
// (classified_links) is kept — it still saves a full-page re-fetch per
// article on every run, independent of cadence.

const MAX_ITEMS = 20
const MAX_DESCRIPTION_LENGTH = 500
const REQUEST_TIMEOUT_MS = 20000
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'

interface RawArticle {
  title: string
  link: string
  description: string
  date: Date | null
}

type ClassifiedLinks = Record<string, { relevant: boolean; checkedAt: string }>

export interface GenerateResult {
  xml: string
  itemCount: number
  classifiedLinks: ClassifiedLinks
}

export async function generateFeedForSource(source: ScrapedSource): Promise<GenerateResult> {
  const candidates = source.type === 'rss'
    ? await collectRssCandidates(source)
    : await collectHtmlCandidates(source)

  const { items, classifiedLinks } = await applyContentFilter(
    candidates,
    source.content_filter,
    source.classified_links ?? {},
  )

  const xml = buildFeedXml(source, items)
  return { xml, itemCount: items.length, classifiedLinks }
}

// ─── HTTP ─────────────────────────────────────────────────────────────────

async function fetchText(url: string, accept: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': accept,
      'Accept-Language': 'en-US,en;q=0.9',
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

// ─── Shared text/link helpers ───────────────────────────────────────────────

function stripHtml(text: string | null | undefined): string {
  if (!text) return ''
  return text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function truncate(text: string, maxLen: number): string {
  if (!text || text.length <= maxLen) return text
  const cut = text.slice(0, maxLen)
  const lastSpace = cut.lastIndexOf(' ')
  return (lastSpace > maxLen * 0.75 ? cut.slice(0, lastSpace) : cut) + '…'
}

function normalizeUrl(url: string | null | undefined, baseUrl: string): string | null {
  if (!url) return null
  const trimmed = url.trim()
  if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('javascript:')) return null
  try {
    return trimmed.startsWith('http') ? trimmed : new URL(trimmed, baseUrl).href
  } catch {
    return null
  }
}

function matchesLinkPattern(link: string, pattern: string | null): boolean {
  if (!pattern) return true
  return link.includes(pattern)
}

function parseArticleDate(rawDate: string): Date | null {
  const normalized = rawDate.replace(/\s+/g, ' ').trim()
  if (!normalized) return null

  const native = new Date(normalized)
  if (!Number.isNaN(native.getTime())) return native

  // "DD.MM.YYYY" / "M/D/YYYY" style numeric dates the native parser rejects.
  const numeric = normalized.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/)
  if (numeric) {
    const first = parseInt(numeric[1], 10)
    const second = parseInt(numeric[2], 10)
    const year = parseInt(numeric[3], 10)
    const month = first > 12 ? second - 1 : first - 1
    const day = first > 12 ? first : second
    if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
      const d = new Date(Date.UTC(year, month, day))
      if (d.getUTCFullYear() === year && d.getUTCMonth() === month && d.getUTCDate() === day) return d
    }
  }
  return null
}

// ─── Content filter + per-article classification memo ──────────────────────

function isContentRelevant(text: string, filter: ContentFilter): boolean {
  if (!text) return false
  const lower = text.toLowerCase()
  const minMatches = filter.minMatches ?? 1
  let matches = 0
  for (const kw of filter.keywords) {
    if (lower.includes(kw.toLowerCase())) {
      matches++
      if (matches >= minMatches) return true
    }
  }
  return false
}

// Memoised in `classifiedLinks` (persisted on the source row) so a
// content-filtered source doesn't re-fetch+re-classify the same article on
// every run. URLs that fail to fetch are left unclassified so the next run
// retries them.
async function classify(
  url: string,
  title: string,
  description: string,
  filter: ContentFilter,
  classifiedLinks: ClassifiedLinks,
): Promise<boolean> {
  if (url in classifiedLinks) return classifiedLinks[url].relevant

  const listingText = [title, description].filter(Boolean).join(' ')
  if (isContentRelevant(listingText, filter)) {
    classifiedLinks[url] = { relevant: true, checkedAt: new Date().toISOString() }
    return true
  }

  if (filter.checkFullContent) {
    try {
      const html = await fetchText(url, 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8')
      const $ = cheerio.load(html)
      $('script, style, nav, header, footer, aside').remove()
      const relevant = isContentRelevant($('body').text(), filter)
      classifiedLinks[url] = { relevant, checkedAt: new Date().toISOString() }
      return relevant
    } catch {
      return false
    }
  }

  classifiedLinks[url] = { relevant: false, checkedAt: new Date().toISOString() }
  return false
}

async function applyContentFilter(
  candidates: RawArticle[],
  filter: ContentFilter | null,
  classifiedLinksIn: ClassifiedLinks,
): Promise<{ items: RawArticle[]; classifiedLinks: ClassifiedLinks }> {
  const classifiedLinks = { ...classifiedLinksIn }
  const kept: RawArticle[] = []
  const seen = new Set<string>()
  const maxScan = filter?.maxScan ?? 50
  let scanned = 0

  for (const candidate of candidates) {
    if (kept.length >= MAX_ITEMS) break
    if (seen.has(candidate.link)) continue

    if (filter) {
      const alreadyClassified = candidate.link in classifiedLinks
      if (!alreadyClassified && scanned >= maxScan) continue
      if (!alreadyClassified) scanned++
      const relevant = await classify(candidate.link, candidate.title, candidate.description, filter, classifiedLinks)
      if (!relevant) continue
    }

    kept.push(candidate)
    seen.add(candidate.link)
  }

  return { items: kept, classifiedLinks }
}

// ─── HTML listing page → candidates ─────────────────────────────────────────

function getPrimaryTitle($: CheerioAPI, $el: Cheerio<AnyNode>, source: ScrapedSource): string {
  const configured = source.title_selector ? stripHtml($el.find(source.title_selector).first().text()) : ''
  if (configured) return configured
  const heading = stripHtml($el.find("h1, h2, h3, h4, [role='heading']").first().text())
  if (heading) return heading
  return stripHtml($el.find('a').first().text())
}

function getPrimaryDescription($el: Cheerio<AnyNode>, source: ScrapedSource): string {
  const configured = source.description_selector ? stripHtml($el.find(source.description_selector).first().text()) : ''
  if (configured) return configured
  return stripHtml($el.find('p').first().text())
}

function extractItemDate($: CheerioAPI, articleEl: AnyNode, source: ScrapedSource): Date | null {
  if (source.date_selector) {
    const el = $(articleEl).find(source.date_selector).first()
    if (el.length) {
      const d = parseArticleDate(el.attr('datetime') || el.text().trim())
      if (d) return d
    }
  }
  const timeEl = $(articleEl).find('time').first()
  if (timeEl.length) {
    const d = parseArticleDate(timeEl.attr('datetime') || timeEl.text().trim())
    if (d) return d
  }
  return null
}

function extractFromJsonLd($: CheerioAPI, source: ScrapedSource): RawArticle[] {
  const results: RawArticle[] = []
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text().trim()
    if (!raw) return
    try {
      const payload = JSON.parse(raw)
      const queue: unknown[] = Array.isArray(payload) ? [...payload] : [payload]
      while (queue.length) {
        const node = queue.shift()
        if (!node || typeof node !== 'object') continue
        const obj = node as Record<string, unknown>
        if (obj['@graph']) queue.push(obj['@graph'])
        if (obj.itemListElement) queue.push(obj.itemListElement)
        if (Array.isArray(node)) { queue.push(...node); continue }

        const type = obj['@type']
        const typeList = Array.isArray(type) ? type : [type]
        const isArticle = typeList.some(t => typeof t === 'string' && /article|blogposting|newsarticle/i.test(t))
        if (!isArticle) continue

        const title = stripHtml(String(obj.headline ?? obj.name ?? ''))
        const link = normalizeUrl(typeof obj.url === 'string' ? obj.url : null, source.url)
        if (!title || !link) continue
        if (!matchesLinkPattern(link, source.link_pattern)) continue

        results.push({
          title,
          link,
          description: stripHtml(String(obj.description ?? '')),
          date: parseArticleDate(String(obj.datePublished ?? obj.dateCreated ?? '')),
        })
      }
    } catch {
      // Malformed JSON-LD — ignore.
    }
  })
  return results
}

function extractFromAnchors($: CheerioAPI, source: ScrapedSource): RawArticle[] {
  const results: RawArticle[] = []
  let siteOrigin: string | null = null
  let listingPathname: string | null = null
  try { siteOrigin = new URL(source.url).origin } catch { /* ignore */ }
  try { listingPathname = new URL(source.url).pathname } catch { /* ignore */ }

  $('a[href]').each((_, el) => {
    const $el = $(el)
    const rawHref = ($el.attr('href') || '').trim()
    const title = stripHtml($el.attr('aria-label') || $el.text())
    if (!rawHref || !title || title.length < 8) return

    const link = normalizeUrl(rawHref, source.url)
    if (!link) return
    if (!matchesLinkPattern(link, source.link_pattern)) return

    try {
      const parsed = new URL(link)
      if (siteOrigin && parsed.origin !== siteOrigin) return
      if (link === source.url) return
      if (listingPathname && parsed.pathname === listingPathname) return
    } catch {
      return
    }
    results.push({ title, link, description: '', date: null })
  })
  return results
}

// Fallback when the configured selectors match nothing (a page redesign,
// typically) — JSON-LD article metadata first, then any on-origin anchor
// that looks like an article link, deduped by URL.
function getFallbackArticles($: CheerioAPI, source: ScrapedSource): RawArticle[] {
  const deduped = new Map<string, RawArticle>()
  for (const a of [...extractFromJsonLd($, source), ...extractFromAnchors($, source)]) {
    if (!deduped.has(a.link)) deduped.set(a.link, a)
  }
  return [...deduped.values()].slice(0, MAX_ITEMS)
}

async function collectHtmlCandidates(source: ScrapedSource): Promise<RawArticle[]> {
  const html = await fetchText(source.url, 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8')
  const $ = cheerio.load(html)

  const primary: RawArticle[] = []
  if (source.article_selector) {
    $(source.article_selector).each((_, el) => {
      const $el = $(el)
      const title = getPrimaryTitle($, $el, source)
      const linkRaw = source.link_selector === 'self'
        ? ($el.attr('href') || '')
        : (source.link_selector ? ($el.find(source.link_selector).attr('href') || '') : '')
      if (!title || !linkRaw.trim()) return

      const link = normalizeUrl(linkRaw.trim(), source.url)
      if (!link) return
      if (!matchesLinkPattern(link, source.link_pattern)) return

      primary.push({
        title,
        link,
        description: truncate(getPrimaryDescription($el, source), MAX_DESCRIPTION_LENGTH),
        date: extractItemDate($, el, source),
      })
    })
  }

  if (primary.length > 0) return primary

  console.warn(`[feedGenerator] no articles matched selectors for ${source.name}; using fallback extraction`)
  return getFallbackArticles($, source).map(a => ({ ...a, description: truncate(a.description, MAX_DESCRIPTION_LENGTH) }))
}

// ─── Existing RSS/Atom feed → re-filtered candidates ────────────────────────

async function collectRssCandidates(source: ScrapedSource): Promise<RawArticle[]> {
  const xml = await fetchText(source.url, 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.7')
  const $ = cheerio.load(xml, { xmlMode: true })
  const results: RawArticle[] = []

  $('item').each((_, el) => {
    const $el = $(el)
    const title = stripHtml($el.find('title').first().text())
    const link = $el.find('link').first().text().trim() || $el.find('guid').first().text().trim()
    if (!title || !link) return
    results.push({
      title,
      link,
      description: truncate(stripHtml($el.find('description').first().text()), MAX_DESCRIPTION_LENGTH),
      date: parseArticleDate($el.find('pubDate').first().text().trim() || $el.find('dc\\:date').first().text().trim()),
    })
  })

  $('entry').each((_, el) => {
    const $el = $(el)
    const title = stripHtml($el.find('title').first().text())
    const link = $el.find('link[href]').first().attr('href') || $el.find('link').first().text().trim() || $el.find('id').first().text().trim()
    if (!title || !link) return
    results.push({
      title,
      link,
      description: truncate(stripHtml($el.find('summary').first().text() || $el.find('content').first().text()), MAX_DESCRIPTION_LENGTH),
      date: parseArticleDate($el.find('published').first().text().trim() || $el.find('updated').first().text().trim()),
    })
  })

  return results
}

// ─── Output XML ──────────────────────────────────────────────────────────

function buildFeedXml(source: ScrapedSource, items: RawArticle[]): string {
  const title = source.feed_title || `${source.name} Feed`
  const description = source.feed_description || `Feed generated for ${source.name}`
  const selfUrl = feedUrl(source.name)

  const itemsXml = items.map(item => `
    <item>
      <title>${escapeXml(item.title)}</title>
      <link>${escapeXml(item.link)}</link>
      <guid isPermaLink="true">${escapeXml(item.link)}</guid>
      ${item.date ? `<pubDate>${item.date.toUTCString()}</pubDate>` : ''}
      ${item.description ? `<description>${escapeXml(item.description)}</description>` : ''}
    </item>`).join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(title)}</title>
    <link>${escapeXml(source.url)}</link>
    <description>${escapeXml(description)}</description>
    <language>en</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="${escapeXml(selfUrl)}" rel="self" type="application/rss+xml"/>
${itemsXml}
  </channel>
</rss>`
}
