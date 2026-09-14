import { NextResponse } from 'next/server'
import { createPublicClient } from '@/lib/supabase/server'
import { articleHref, safeImageUrl, imageMimeType, escapeXml } from '@/lib/utils'

export const dynamic = 'force-dynamic'

const BASE_URL = 'https://locreport.com'

export async function GET() {
  const supabase = createPublicClient()

  const { data: articles } = await supabase
    .from('articles')
    .select('id, title, slug, excerpt, author, published_at, image_url')
    .order('published_at', { ascending: false })
    .limit(50)

  const items = (articles ?? [])
    .map(a => {
      const link = `${BASE_URL}${articleHref(a.slug)}`
      // Readers show the lead image when the item carries an enclosure.
      const image = safeImageUrl(a.image_url)
      const imageAbs = image ? new URL(image, BASE_URL).toString() : null
      return `
    <item>
      <title>${escapeXml(a.title)}</title>
      <link>${escapeXml(link)}</link>
      <guid isPermaLink="true">${escapeXml(link)}</guid>
      <pubDate>${new Date(a.published_at).toUTCString()}</pubDate>
      ${a.author ? `<dc:creator>${escapeXml(a.author)}</dc:creator>` : ''}
      ${a.excerpt ? `<description>${escapeXml(a.excerpt)}</description>` : ''}
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
    <description>Daily translation and localization news capturing the trends, innovations, and movements shaping the language services industry.</description>
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
