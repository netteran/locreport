import { type ContentType, type PostReference, articleHref, getContentType, validSlugSegment } from './contentTaxonomy'
import { canonicalLegacyArticleSlug } from './legacyArticleSlugs'
import { canonicalMonthlyReportSlug } from './monthlyReportSlugs'
import { fetchWithRetry } from './supabase/fetchWithRetry'

export type PublicArticleReference = PostReference & { id: string; published_at: string }

function choose(rows: PublicArticleReference[], type?: ContentType) {
  return rows.find(row => type && getContentType(row) === type)
    ?? rows.find(row => row.slug.toLowerCase() === row.content_slug)
    ?? rows[0] ?? null
}

async function lookup(
  table: 'articles' | 'public_article_index',
  filter: Record<string, string>,
  limit: number,
) {
  const url = new URL('/rest/v1/' + table, process.env.NEXT_PUBLIC_SUPABASE_URL!)
  url.search = new URLSearchParams({
    select: 'id,slug,article_type,content_type,content_slug,published_at',
    order: 'published_at.asc,id.asc',
    published_at: 'not.is.null',
    limit: String(limit),
    ...filter,
  }).toString()
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const response = await fetchWithRetry(url, {
    // No `next.revalidate`: callers are either already-cached pages or
    // middleware/API routes, so a Data Cache entry per lookup key (including
    // every junk URL a crawler probes) was pure ISR-write cost.
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  })
  if (!response.ok) throw new Error(`Public article lookup returned HTTP ${response.status}`)
  return await response.json() as PublicArticleReference[]
}

const escapeLike = (value: string) => value.replace(/[\\%_]/g, '\\$&')

/** Shared by the edge redirect and the server-rendered detail routes. */
export async function resolvePublicArticle(parts: string[], type?: ContentType) {
  if (!parts.length || !parts.every(validSlugSegment)) return null
  const bare = parts.at(-1)!.toLowerCase()
  if (parts.length > 1) {
    const dated = await lookup('articles', { slug: `eq.${parts.join('/')}` }, 1)
    if (dated.length) return dated[0]
  }

  const legacy = canonicalLegacyArticleSlug(bare)
  const aliases = !type || type === 'report' ? canonicalMonthlyReportSlug(legacy) : legacy
  const exact = await lookup('public_article_index', { content_slug: `eq.${aliases}` }, 3)
  if (exact.length) return choose(exact, type)

  // Older Jekyll URLs were sometimes truncated, or collapsed runs of dashes.
  // Only redirect when the legacy match resolves to one public destination.
  const prefix = await lookup('public_article_index', { content_slug: `like.${escapeLike(bare)}%` }, 2)
  if (prefix.length === 1) return prefix[0]

  if (bare.includes('-')) {
    const collapse = (slug: string) => slug.replace(/-+/g, '-')
    const normalized = collapse(bare)
    const pattern = normalized.split('-').map(escapeLike).join('-%')
    const loose = await lookup('public_article_index', { content_slug: `like.%${pattern}` }, 12)
    const matching = loose.filter(row => collapse(row.content_slug ?? '') === normalized)
    if (new Set(matching.map(articleHref)).size === 1) return matching[0]
  }

  return null
}
