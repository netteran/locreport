import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { autoStep } from '@/lib/podcastRun'
import { isCronRequest } from '@/lib/adminAuth'

export const maxDuration = 300

/** Collects episode evidence for auto_collect sources. Source trust controls Fact Flow separately. */
export async function POST(req: NextRequest) {
  const isCron = isCronRequest(req)
  if (!isCron) {
    const session = await createClient()
    const { data: { user } } = await session.auth.getUser()
    if (!user || user.email !== process.env.ADMIN_EMAIL) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const id = new URL(req.url).searchParams.get('id')
  if (!isCron && !id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const supabase = createServiceClient()
  let query = supabase.from('rss_sources').select('*').eq('kind', 'podcast').eq('active', true)
  query = id ? query.eq('id', id) : query.eq('auto_collect', true)
  const { data: sources, error } = await query.order('created_at', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  for (const source of sources ?? []) {
    const result = await autoStep(supabase, source)
    if (result.action !== 'idle') {
      console.log(`[podcast-auto] ${source.name}: ${JSON.stringify(result)}`)
      return NextResponse.json(result)
    }
  }
  return NextResponse.json({ action: 'idle' })
}

export async function GET(req: NextRequest) {
  return POST(req)
}
