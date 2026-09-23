import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { autoStep } from '@/lib/podcastRun'

export const maxDuration = 300

/**
 * Automatic podcast runs. Each call does ONE unit of work — write up a
 * notes-only draft, or take one new episode through step 1 — so it always fits
 * a single 300 s function; callers repeat until `{ action: 'idle' }`.
 *
 * - CRON_SECRET (ingest.yml, after the feed ingest): only podcast sources with
 *   `auto_publish = true`, which also get their finished drafts published.
 * - Admin session, `?id=<source>` (the row's Ingest button): that one source,
 *   whatever its auto_publish setting; drafts are published only if it is on.
 *
 * Only episodes after the source's `ignore_before` baseline are ever touched.
 */
export async function POST(req: NextRequest) {
  const isCron = req.headers.get('Authorization') === `Bearer ${process.env.CRON_SECRET}`
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
  query = id ? query.eq('id', id) : query.eq('auto_publish', true)
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
