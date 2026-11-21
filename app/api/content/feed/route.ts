import { NextRequest, NextResponse } from 'next/server'
import { isContentType } from '@/lib/contentTaxonomy'
import { loadContentFeed } from '@/lib/contentFeed'
import { feedPageNumber, validFeedCursor } from '@/lib/feedPagination'

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams
  const page = feedPageNumber(query.get('page') ?? '1')
  const filter = query.get('type') ?? 'all'
  const date = query.get('before')
  const id = query.get('id')
  const cursor = date && id ? { publishedAt: date, id } : undefined
  if (page === null || (filter !== 'all' && !isContentType(filter))
    || ((date !== null || id !== null) && (!cursor || !validFeedCursor(cursor)))) {
    return NextResponse.json({ error: 'Invalid feed page, type or cursor.' }, { status: 400 })
  }
  try {
    return NextResponse.json(await loadContentFeed(page, filter, cursor), {
      headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
    })
  } catch (error) {
    console.error('[content-feed]', error)
    return NextResponse.json({ error: 'The feed is temporarily unavailable.' }, { status: 503 })
  }
}
