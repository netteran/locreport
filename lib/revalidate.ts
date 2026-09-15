import { revalidatePath } from 'next/cache'
import { articleHref } from '@/lib/utils'

/**
 * On-demand cache invalidation for the public surfaces that render articles
 * and Fact Flow facts.
 *
 * Why this exists: `/articles` reads `searchParams`, which makes it a Dynamic
 * API route rendered fresh on every request — so an approved draft appeared
 * there instantly. The homepage and `/fact-flow` are the opposite: they use the
 * cookie-free `createPublicClient()` and export `revalidate = 3600`, so they
 * are genuinely static and were served from cache for up to an hour after a
 * publish. Nothing invalidated them, so "approved" and "visible" were an hour
 * or more apart, and `revalidate` being stale-while-revalidate made it worse —
 * the first visitor after expiry still got the stale page and only triggered
 * the rebuild in the background.
 *
 * Dropping the `revalidate` window instead would re-open the request-volume
 * problem `createPublicClient()` was introduced to solve (~4,000 article
 * queries a day). Invalidating on write keeps the pages fully cached for
 * anonymous traffic while making a publish show up immediately.
 *
 * Call these from every route that writes an article or a fact.
 */

/** Cached pages whose content is the article stream. */
const ARTICLE_PATHS = [
  '/',
  '/intelligence',
  '/intelligence/signals',
  '/intelligence/high-impact',
]

/** Cached pages that render published facts — the stream and the homepage rail. */
const FACT_PATHS = ['/', '/fact-flow']

function revalidateAll(paths: Iterable<string>) {
  for (const path of paths) {
    try {
      revalidatePath(path)
    } catch (err) {
      // Never let cache housekeeping fail a publish. The page still turns over
      // on its own `revalidate` window, so the worst case is the old behaviour.
      console.error(`[revalidate] could not revalidate ${path}:`, err)
    }
  }
}

/**
 * A published article changed. Covers the article surfaces plus Fact Flow,
 * since publishing an article also publishes its fact.
 *
 * Pass `slug` to also turn over that article's own 24h-cached detail page —
 * it matters on an edit, and is harmless on a first publish. It goes through
 * `articleHref()` rather than being interpolated directly, because legacy
 * Jekyll slugs carry path segments (`2024/01/15/foo`) while the page they are
 * served at is the clean `/articles/foo`. Interpolating raw would revalidate a
 * path that nothing is cached under, and fail silently.
 *
 * `/intelligence/signals/[id]` is deliberately not revalidated wholesale: the
 * per-signal pages are cheap to leave on their 1h window, and invalidating the
 * whole dynamic segment would stampede regeneration across every signal.
 * `/articles` needs nothing — it is dynamic already.
 */
export function revalidateArticleSurfaces(opts: { slug?: string | null; monthlyReport?: boolean } = {}) {
  const paths = new Set([...ARTICLE_PATHS, ...FACT_PATHS])
  if (opts.slug) paths.add(articleHref(opts.slug))
  if (opts.monthlyReport) paths.add('/reports/monthly')
  revalidateAll(paths)
}

/** A fact changed without an article being written — hand edits and backfills. */
export function revalidateFactSurfaces() {
  revalidateAll(FACT_PATHS)
}
