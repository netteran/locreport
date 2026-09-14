import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { feedUrl } from '@/lib/feedUrl'

export async function GET() {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('scraped_sources')
    .select('*')
    .order('name', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  // Generating a feed does nothing on its own — ingest only reads rss_sources. Report
  // the link status per feed so an unwired feed is visible instead of silently idle.
  const { data: rows } = await supabase.from('rss_sources').select('id, url, active')
  const byUrl = new Map((rows ?? []).map(r => [r.url, r]))

  return NextResponse.json(
    (data ?? []).map(feed => {
      const row = byUrl.get(feedUrl(feed.name))
      return {
        ...feed,
        in_sources: !!row,
        source_id: row?.id ?? null,
        source_active: row?.active ?? null,
      }
    }),
  )
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('scraped_sources')
    .insert({
      name: body.name,
      type: body.type ?? 'html',
      url: body.url,
      active: body.active ?? true,
      article_selector: body.article_selector ?? null,
      title_selector: body.title_selector ?? null,
      link_selector: body.link_selector ?? null,
      description_selector: body.description_selector ?? null,
      date_selector: body.date_selector ?? null,
      link_pattern: body.link_pattern ?? null,
      feed_title: body.feed_title ?? null,
      feed_description: body.feed_description ?? null,
      content_filter: body.content_filter ?? null,
      keywords: body.keywords ?? [],
    })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data, { status: 201 })
}
