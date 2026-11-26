import { revalidatePath } from 'next/cache'
import { articleHref, CONTENT_TYPES, CONTENT_TAXONOMY, type PostReference } from '@/lib/contentTaxonomy'

// Deliberately NOT here: `/sitemap.xml` and the `/page/[num]` archive. Every
// path invalidated on publish is regenerated (and billed as ISR writes, per
// 8 KB) on its next visit, and crawlers visit all of them. Invalidating the
// ~125 paginated pages plus a ~1,500-URL sitemap on every auto-publish is what
// pushed the Hobby plan past its 200K monthly ISR-write limit (Nov 2026). Both
// refresh on their own `revalidate` window instead.
const ARTICLE_PATHS = [
  '/',
  ...CONTENT_TYPES.map(type => CONTENT_TAXONOMY[type].path),
]

// `/feed.xml` and `/fact-flow/feed.xml` are force-dynamic, so they need no invalidation.
const FACT_PATHS = ['/', '/fact-flow']

function revalidateAll(paths: Iterable<string>) {
  for (const path of paths) {
    try {
      revalidatePath(path)
    } catch (err) {
      console.error(`[revalidate] could not revalidate ${path}:`, err)
    }
  }
}

/** A publish can change every chronological page and may publish a Fact Flow item. */
export function revalidateArticleSurfaces(...articles: (PostReference | undefined)[]) {
  const paths = new Set([...ARTICLE_PATHS, ...FACT_PATHS])
  for (const article of articles) {
    if (article) paths.add(articleHref(article))
  }
  revalidateAll(paths)
}

/** A fact changed without an article being written — hand edits and backfills. */
export function revalidateFactSurfaces() {
  revalidateAll(FACT_PATHS)
}

/** The cached page that renders the whole directory listing. */
const DIRECTORY_PATHS = ['/directory']

/**
 * A directory entry changed. Both public directory surfaces read through the
 * cookie-free `createPublicClient()` and export `revalidate = 3600`, so they are
 * genuinely static — and nothing invalidated them, which made an admin edit
 * (an uploaded logo above all) invisible for an hour or more even though the
 * row and the storage object were both already correct.
 *
 * Pass every slug the write touched. The admin form lets the slug be edited, so
 * a rename changes one row but two paths — the URL it used to live at and the
 * one it lives at now — and callers pass both. As with articles, the
 * `[slug]` segment is never revalidated wholesale: that would stampede
 * regeneration across every entry in the directory.
 */
export function revalidateDirectorySurfaces(...slugs: (string | null | undefined)[]) {
  const paths = new Set<string>(DIRECTORY_PATHS)
  for (const slug of slugs) {
    if (slug) paths.add(`/directory/${slug}`)
  }
  revalidateAll(paths)
}
