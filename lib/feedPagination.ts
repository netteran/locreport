export const FEED_PAGE_SIZE = 12

export function feedPageNumber(value: string | undefined): number | null {
  if (!value || !/^[1-9]\d*$/.test(value)) return null
  const number = Number(value)
  // PostgREST/HTTP range positions are signed 32-bit integers.
  return number <= Math.floor(2_147_483_647 / FEED_PAGE_SIZE) ? number : null
}

export function feedPagePath(page: number): string {
  return page === 1 ? '/' : `/page/${page}/`
}

export function feedPageFromPath(path: string) {
  if (path === '/') return 1
  return feedPageNumber(path.match(/^\/page\/(\d+)\/?$/)?.[1])
}

export type FeedCursor = { publishedAt: string; id: string }

export function validFeedCursor(cursor: FeedCursor) {
  return /^[\dT:.+Z-]{10,40}$/.test(cursor.publishedAt)
    && Number.isFinite(Date.parse(cursor.publishedAt))
    && /^[a-z0-9_-]{1,80}$/i.test(cursor.id)
}
