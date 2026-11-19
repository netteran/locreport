import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ name: string }> }

// Public feed output for one scraped_sources row — this is the URL an
// rss_sources row points at to get generator output into the regular
// ingest pipeline. Content is whatever /api/scraped-sources/run last wrote;
// nothing is generated on request.
export async function GET(_req: Request, { params }: Params) {
  const { name } = await params
  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('scraped_sources')
    .select('generated_xml, active')
    .eq('name', name)
    .single()

  if (error || !data || !data.active || !data.generated_xml) {
    return NextResponse.json({ error: 'Feed not found or not yet generated' }, { status: 404 })
  }

  return new NextResponse(data.generated_xml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      // Generation runs immediately before collection; a cached older XML body
      // can otherwise turn a successful refresh into a false zero-result run.
      'Cache-Control': 'no-store',
    },
  })
}
