import Parser from 'rss-parser'

export interface RssItem {
  title: string
  link: string
  contentSnippet?: string
  content?: string
  pubDate?: string
  /**
   * The outlet that actually published the item, when the feed says so.
   * Aggregators (Google News) carry it in `<source>`; ordinary feeds don't,
   * since the feed itself is the publisher.
   */
  sourceName?: string
}

type SourceField = string | { _?: string } | undefined
type ParsedItem = { source?: SourceField }

const parser = new Parser<Record<string, unknown>, ParsedItem>({ customFields: { item: ['source'] } })

// Fallback for feeds that aren't well-formed XML (Nimdzi's WordPress feed
// carries a bare HTML attribute like `<iframe allowfullscreen>`, which the
// strict parser rejects outright). Non-strict sax upper-cases names, so they
// are lower-cased back, restoring the two camelCase tags rss-parser reads.
const CAMEL_TAGS: Record<string, string> = { pubdate: 'pubDate', lastbuilddate: 'lastBuildDate' }
const lowerName = (name: string) => CAMEL_TAGS[name.toLowerCase()] ?? name.toLowerCase()
const lenientParser = new Parser<Record<string, unknown>, ParsedItem>({
  customFields: { item: ['source'] },
  xml2js: { strict: false, tagNameProcessors: [lowerName], attrNameProcessors: [lowerName] },
})

export function isGoogleNewsUrl(url: string | null | undefined): boolean {
  return !!url && /^https?:\/\/news\.google\.com\//i.test(url)
}

/**
 * Google News items name the real outlet in `<source url="…">Outlet</source>`
 * and repeat it as a " - Outlet" title suffix. The title loses the suffix, and
 * the outlet is kept so the article can credit it instead of the feed.
 */
function splitAggregatorItem(title: string, source: SourceField, link: string) {
  const fromTag = (typeof source === 'string' ? source : source?._ ?? '').trim()
  if (!isGoogleNewsUrl(link)) return { title, sourceName: fromTag || undefined }

  const cut = title.lastIndexOf(' - ')
  const suffix = cut > 0 ? title.slice(cut + 3).trim() : ''
  const sourceName = fromTag || suffix || undefined
  const cleanTitle = sourceName && suffix === sourceName ? title.slice(0, cut).trim() : title
  return { title: cleanTitle, sourceName }
}

async function parseFeedXml(xml: string) {
  try {
    return await parser.parseString(xml)
  } catch (err) {
    try {
      return await lenientParser.parseString(xml)
    } catch {
      throw err
    }
  }
}

/**
 * Fetch the full text of an article URL by downloading the page HTML and
 * stripping tags. Returns null if the fetch fails or the URL looks like it
 * won't yield readable article text (e.g. Google News redirect URLs).
 */
export async function fetchArticleText(url: string): Promise<string | null> {
  // Google News redirect URLs: follow the HTTP redirect to reach the real article
  if (isGoogleNewsUrl(url) && url.includes('/rss/articles/')) {
    const resolved = await resolveGoogleNewsUrl(url)
    if (!resolved) return null
    console.log(`[rss] Google News resolved: ${url} → ${resolved}`)
    url = resolved
  }

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) {
      console.warn(`[rss] fetchArticleText HTTP ${res.status} for ${url}`)
      return null
    }
    const html = await res.text()
    return htmlToText(html)
  } catch (err) {
    console.warn(`[rss] fetchArticleText failed for ${url}:`, err instanceof Error ? err.message : err)
    return null
  }
}

async function resolveGoogleNewsUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36' },
      redirect: 'manual',
      signal: AbortSignal.timeout(5000),
    })
    const location = res.headers.get('location')
    if (location && !location.includes('news.google.com')) return location
    // Some Google News URLs do a JS redirect — try following normally and read the final URL
    const followed = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36' },
      redirect: 'follow',
      signal: AbortSignal.timeout(5000),
    })
    if (followed.url && !followed.url.includes('news.google.com')) return followed.url
    return null
  } catch {
    return null
  }
}

function htmlToText(html: string): string {
  // Remove script, style, nav, header, footer, aside blocks entirely
  let text = html
    .replace(/<(script|style|nav|header|footer|aside|noscript)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    // Remove all remaining tags
    .replace(/<[^>]+>/g, ' ')
    // Decode common HTML entities
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#\d+;/g, ' ')
    // Collapse whitespace
    .replace(/\s+/g, ' ')
    .trim()

  // Cap at ~8 000 chars to avoid excessive token usage
  return text.slice(0, 8000)
}

export async function fetchFeed(url: string): Promise<RssItem[]> {
  return (await fetchFeedResult(url)).items
}

// Like fetchFeed, but says why a fetch came back empty. A dead feed (404,
// HTML where XML should be) and a quiet one both yield zero items, so ingest
// records this on the source row for /admin/sources to show.
export async function fetchFeedResult(url: string): Promise<{ items: RssItem[]; error: string | null }> {
  try {
    // Use fetch + parseString to avoid rss-parser's internal url.parse() call
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.7',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    })
    if (!res.ok) {
      throw new Error(res.status === 403
        ? 'HTTP 403 — the site refuses server requests (bot protection), not a wrong URL'
        : `HTTP ${res.status}`)
    }
    const xml = await res.text()
    const feed = await parseFeedXml(xml)
    // WordPress serves /<page>/feed/ for a *page* as that page's comments feed:
    // valid RSS, zero items, forever. Say so rather than report a quiet feed.
    if (feed.items.length === 0 && /^comments on:/i.test(feed.title ?? '')) {
      throw new Error(`WordPress comments feed ("${feed.title}"), not a posts feed — use the site's /feed/ or a /category/<name>/feed/ URL`)
    }
    const base = new URL(url).origin
    const items = feed.items.map((item) => {
      let link = item.link ?? ''
      if (link && link.startsWith('/')) link = base + link
      const { title, sourceName } = splitAggregatorItem(item.title ?? '', item.source, link)
      return {
        title,
        link,
        sourceName,
        contentSnippet: item.contentSnippet,
        content: item.content,
        pubDate: item.pubDate,
      }
    })
    return { items, error: null }
  } catch (err) {
    console.error(`[rss] fetchFeed failed for ${url}:`, err)
    const message = err instanceof Error ? err.message : String(err)
    return { items: [], error: message.slice(0, 500) }
  }
}
