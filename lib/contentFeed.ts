import { articleHref, getContentType, type ContentFilter, type ContentType, type PostReference } from './contentTaxonomy'
import { FEED_PAGE_SIZE, type FeedCursor } from './feedPagination'
import { monthlyReportTitle, monthlyReportSubtitle, type BriefingCoverage } from './briefingDisplay'
import { createPublicClient } from './supabase/server'
import { safeImageUrl } from './utils'
import { imageFrameOf, type ImageFrame } from './imageFrame'

export type FeedPost = FeedCursor & {
  href: string
  title: string
  excerpt: string | null
  author: string | null
  imageUrl: string | null
  imageFrame: ImageFrame
  contentType: ContentType
}

export type FeedPage = { page: number; posts: FeedPost[]; nextPage: number | null }

type FeedRow = PostReference & BriefingCoverage & {
  id: string
  title: string
  excerpt: string | null
  author: string | null
  image_url: string | null
  published_at: string
}

export async function loadContentFeed(page: number, filter: ContentFilter = 'all', before?: FeedCursor): Promise<FeedPage> {
  let query = createPublicClient().from('public_article_index')
    .select('id,slug,content_slug,content_type,article_type,title,excerpt,author,image_url,published_at,monthly_period,report_start_date,report_end_date')
    .order('published_at', { ascending: false }).order('id', { ascending: false })
  if (filter !== 'all') query = query.eq('content_type', filter)
  // Appending uses the last item's cursor so a new publish between requests
  // cannot shift the already rendered stories. Direct visits use page offsets.
  if (before) {
    query = query.or(`published_at.lt.${before.publishedAt},and(published_at.eq.${before.publishedAt},id.lt.${before.id})`)
  }
  const offset = before ? 0 : (page - 1) * FEED_PAGE_SIZE
  const { data, error } = await query.range(offset, offset + FEED_PAGE_SIZE).returns<FeedRow[]>()
  if (error) throw new Error(`Could not load the public feed: ${error.message}`)

  const rows = data ?? []
  const posts = rows.slice(0, FEED_PAGE_SIZE).map(row => {
    const contentType = getContentType(row)
    return {
      id: row.id,
      title: contentType === 'report' ? monthlyReportTitle(row) : row.title,
      excerpt: contentType === 'report' ? monthlyReportSubtitle(row.excerpt) : row.excerpt,
      href: articleHref(row),
      imageUrl: safeImageUrl(row.image_url),
      imageFrame: imageFrameOf(row.image_url),
      author: row.author,
      publishedAt: row.published_at,
      contentType,
    }
  })
  return { page, posts, nextPage: rows.length > FEED_PAGE_SIZE ? page + 1 : null }
}
