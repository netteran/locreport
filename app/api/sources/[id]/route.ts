import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { parsePodcastConfig } from '@/lib/podcast'

type Params = { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params
  const body = await req.json()
  if ('podcast_config' in body) {
    const parsed = parsePodcastConfig(body.podcast_config)
    if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
    body.podcast_config = parsed.config
  }
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('rss_sources')
    .update(body)
    .eq('id', id)
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data)
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params
  const supabase = createServiceClient()
  const { error } = await supabase.from('rss_sources').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return new NextResponse(null, { status: 204 })
}
