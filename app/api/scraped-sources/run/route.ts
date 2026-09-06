import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { generateFeedForSource } from '@/lib/feedGenerator'
import type { ScrapedSource } from '@/lib/types'

export const maxDuration = 300

export async function GET(req: NextRequest) {
  return POST(req)
}

export async function POST(req: NextRequest) {
  const auth = req.headers.get('Authorization')
  const isCron = auth === `Bearer ${process.env.CRON_SECRET}`

  if (!isCron) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user || user.email !== process.env.ADMIN_EMAIL) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const supabase = createServiceClient()
  const { searchParams } = new URL(req.url)
  const onlyId = searchParams.get('id')

  let query = supabase.from('scraped_sources').select('*').eq('active', true)
  if (onlyId) query = supabase.from('scraped_sources').select('*').eq('id', onlyId)
  const { data: sources, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  if (!sources?.length) return NextResponse.json({ processed: 0, succeeded: 0, failed: 0, results: [] })

  const results: { name: string; status: 'success' | 'error'; itemCount?: number; error?: string }[] = []

  for (const source of sources as ScrapedSource[]) {
    try {
      const { xml, itemCount, classifiedLinks } = await generateFeedForSource(source)
      await supabase.from('scraped_sources').update({
        generated_xml: xml,
        classified_links: classifiedLinks,
        last_run_at: new Date().toISOString(),
        last_status: 'success',
        last_error: null,
        last_item_count: itemCount,
        updated_at: new Date().toISOString(),
      }).eq('id', source.id)
      results.push({ name: source.name, status: 'success', itemCount })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[scraped-sources/run] ${source.name}:`, err)
      await supabase.from('scraped_sources').update({
        last_run_at: new Date().toISOString(),
        last_status: 'error',
        last_error: message,
        updated_at: new Date().toISOString(),
      }).eq('id', source.id)
      results.push({ name: source.name, status: 'error', error: message })
    }
  }

  const succeeded = results.filter(r => r.status === 'success').length
  return NextResponse.json({ processed: results.length, succeeded, failed: results.length - succeeded, results })
}
