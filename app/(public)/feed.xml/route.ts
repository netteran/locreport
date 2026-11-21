import { NextResponse } from 'next/server'
import { createPublicClient } from '@/lib/supabase/server'
import { articleHref, articleSlug, CONTENT_TAXONOMY, getContentType, type PostReference } from '@/lib/contentTaxonomy'
import { safeImageUrl, imageMimeType, escapeXml } from '@/lib/utils'

import { monthlyReportTitle, monthlyReportSubtitle, type BriefingCoverage } from '@/lib/briefingDisplay'
import { previousMonthlyReportSlug } from '@/lib/monthlyReportSlugs'
import { withOptionalBriefingCoverage } from '@/lib/briefingCoverage'

type FeedArticle = BriefingCoverage & PostReference & {
  title: string
  slug: string
  excerpt: string | null
  author: string | null
  published_at: string
  image_url: string | null
  article_type: string | null
}

export const dynamic = 'force-dynamic'

const BASE_URL = 'https://locreport.com'

export async function GET() {
  const supabase = createPublicClient()

  const { data: articles } = await withOptionalBriefingCoverage(columns => supabase
    .from('public_article_index')
    .select('title, slug, excerpt, author, published_at, image_url, article_type, content_type, content_slug' + columns)
    .order('published_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(50).returns<FeedArticle[]>())

  const items = (articles ?? [])
    .map(a => {
      const type = getContentType(a)
      const isReport = type === 'report'
      const title = isReport ? monthlyReportTitle(a) : a.title
      const excerpt = isReport ? monthlyReportSubtitle(a.excerpt) : a.excerpt
      const link = `${BASE_URL}${articleHref(a)}`
      // Keep the original RSS ID for editions already delivered to subscribers.
      const previousSlug = isReport ? previousMonthlyReportSlug(articleSlug(a)) : undefined
      const legacySlug = previousSlug ?? a.slug.split('/').filter(Boolean).at(-1) ?? articleSlug(a)
      const guid = `${BASE_URL}/articles/${legacySlug}`
      // Readers show the lead image when the item carries an enclosure.
      const image = safeImageUrl(a.image_url)
      const imageAbs = image ? new URL(image, BASE_URL).toString() : null
      return `
    <item>
      <title>${escapeXml(title)}</title>
      <link>${escapeXml(link)}</link>
      <category>${CONTENT_TAXONOMY[type].section}</category>
      <guid isPermaLink="true">${escapeXml(guid)}</guid>
      <pubDate>${new Date(a.published_at).toUTCString()}</pubDate>
      ${a.author ? `<dc:creator>${escapeXml(a.author)}</dc:creator>` : ''}
      ${excerpt ? `<description>${escapeXml(excerpt)}</description>` : ''}
      ${imageAbs ? `<enclosure url="${escapeXml(imageAbs)}" type="${imageMimeType(imageAbs)}" length="0"/>` : ''}
    </item>`
    }).join('\n')

  const lastBuildDate = articles?.[0]
    ? new Date(articles[0].published_at).toUTCString()
    : new Date().toUTCString()

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>LocReport</title>
    <link>${BASE_URL}</link>
    <description>Independent briefs, analysis and monthly reports on localization, language services and AI.</description>
    <language>en-us</language>
    <lastBuildDate>${lastBuildDate}</lastBuildDate>
    <atom:link href="${BASE_URL}/feed.xml" rel="self" type="application/rss+xml"/>
    <image>
      <url>${BASE_URL}/icon.png</url>
      <title>LocReport</title>
      <link>${BASE_URL}</link>
    </image>
${items}
  </channel>
</rss>`

  return new NextResponse(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  })
}
