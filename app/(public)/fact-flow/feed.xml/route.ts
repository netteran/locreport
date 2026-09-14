import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { CATEGORY_LABELS, type FactCategory } from '@/lib/facts'
import { escapeXml } from '@/lib/utils'

export const dynamic = 'force-dynamic'

const BASE_URL = 'https://locreport.com'

export async function GET() {
  const supabase = await createClient()

  // Only facts attached to a published article. A fact is created at ingest time,
  // before its draft is reviewed, so an unattached fact belongs to a draft that was
  // rejected or is still pending — it must not reach a public feed. The /fact-flow
  // page, the homepage strip and the tweet job all filter the same way; this route
  // did not, so rejected material was being served here.
  const { data: facts } = await supabase
    .from('facts')
    .select('id, content, category, article_id, created_at')
    .not('article_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(100)

  // Resolve article slugs in one query
  const articleIds = [...new Set((facts ?? []).map(f => f.article_id).filter(Boolean))] as string[]
  const slugMap = new Map<string, string>()
  if (articleIds.length > 0) {
    const { data: articles } = await supabase
      .from('articles')
      .select('id, slug')
      .in('id', articleIds)
    for (const a of articles ?? []) slugMap.set(a.id, a.slug)
  }

  type FactRow = { id: string; content: string; category: string; article_id: string | null; created_at: string }
  const items = (facts as FactRow[] ?? [])
    .filter(f => f.article_id && slugMap.has(f.article_id))
    .map(f => {
      const slug = slugMap.get(f.article_id!)!
      const link = `${BASE_URL}/articles/${slug}`
      const title = f.content.slice(0, 100) + (f.content.length > 100 ? '…' : '')
      const pubDate = new Date(f.created_at).toUTCString()
      const guid = `${BASE_URL}/fact-flow#${f.id}`

      return `
    <item>
      <title>${escapeXml(title)}</title>
      <link>${escapeXml(link)}</link>
      <guid isPermaLink="false">${escapeXml(guid)}</guid>
      <pubDate>${pubDate}</pubDate>
      <description>${escapeXml(f.content)}</description>
    </item>`
    }).join('\n')

  const lastBuildDate = facts?.[0]
    ? new Date(facts[0].created_at).toUTCString()
    : new Date().toUTCString()

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>LocReport Fact Flow</title>
    <link>${BASE_URL}/fact-flow</link>
    <description>Bare facts from the localization and language technology industry, linking to full articles on LocReport.</description>
    <language>en-us</language>
    <lastBuildDate>${lastBuildDate}</lastBuildDate>
    <atom:link href="${BASE_URL}/fact-flow/feed.xml" rel="self" type="application/rss+xml"/>
    <image>
      <url>${BASE_URL}/icon.png</url>
      <title>LocReport Fact Flow</title>
      <link>${BASE_URL}/fact-flow</link>
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
