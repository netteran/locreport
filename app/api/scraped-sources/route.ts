import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('scraped_sources')
    .select('*')
    .order('name', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data)
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
    })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data, { status: 201 })
}
