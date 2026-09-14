import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { feedUrl } from '@/lib/feedUrl'

type Params = { params: Promise<{ id: string }> }

// Promotes a generated feed into an rss_sources row so ingest actually reads it.
// The URL is built server-side from SITE_URL: ingest fetches it from a serverless
// function, so a window.location-derived origin would break outside production.
export async function POST(_req: NextRequest, { params }: Params) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.email !== process.env.ADMIN_EMAIL) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const service = createServiceClient()
  const { data: feed, error } = await service
    .from('scraped_sources').select('*').eq('id', id).single()
  if (error || !feed) return NextResponse.json({ error: 'Feed not found' }, { status: 404 })

  const url = feedUrl(feed.name)

  // Idempotent: a second click should report the existing row, not duplicate it.
  const { data: existing } = await service
    .from('rss_sources').select('id, active').eq('url', url).maybeSingle()
  if (existing) {
    return NextResponse.json({ ...existing, url, already_linked: true })
  }

  const { data: created, error: insertError } = await service
    .from('rss_sources')
    .insert({ url, name: feed.name, keywords: feed.keywords ?? [] })
    .select('id, active')
    .single()
  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 400 })

  return NextResponse.json({ ...created, url, already_linked: false }, { status: 201 })
}
