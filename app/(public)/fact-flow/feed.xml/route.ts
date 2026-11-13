import { NextResponse } from 'next/server'
import { createPublicClient } from '@/lib/supabase/server'
import { loadPublishedFacts, factPermalink, httpUrl } from '@/lib/publicFacts'
import { articleHref } from '@/lib/utils'
import { escapeXml } from '@/lib/utils'

export const dynamic = 'force-dynamic'

const BASE_URL = 'https://locreport.com'

export async function GET() {
  const supabase = createPublicClient()

  const facts = await loadPublishedFacts(supabase, 100)
  const items = facts.map(f => {
    const title = f.content.slice(0,100)+(f.content.length>100?'…':'')
    const link=factPermalink(f.id)
    const source=httpUrl(f.source_url)
    const description=`<p>${escapeXml(f.content)}</p>`
      +(source?`<p><a href="${escapeXml(source)}">Source: ${escapeXml(f.source_name||'Original reporting')}</a></p>`:'')
      +f.analyses.map(a=>`<p><a href="${BASE_URL}${articleHref(a.slug)}">LocReport analysis: ${escapeXml(a.title)}</a></p>`).join('')
    return `<item><title>${escapeXml(title)}</title><link>${escapeXml(link)}</link>
      <guid isPermaLink="false">${escapeXml(link)}</guid><pubDate>${new Date(f.published_at).toUTCString()}</pubDate>
      <description>${escapeXml(description)}</description></item>`
  }).join('')
  const lastBuildDate=facts[0]?new Date(facts[0].published_at).toUTCString():new Date().toUTCString()

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>LocReport Fact Flow</title>
    <link>${BASE_URL}/fact-flow</link>
    <description>Sourced news from the localization and language technology industry, with links to original reporting and related LocReport analysis.</description>
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
