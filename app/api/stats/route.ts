import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = createServiceClient()
  const [articles, drafts, sources] = await Promise.all([
    supabase.from('articles').select('id', { count: 'exact', head: true }),
    supabase.from('drafts').select('id', { count: 'exact', head: true }).eq('status', 'pending').eq('research_only',false),
    supabase.from('rss_sources').select('id', { count: 'exact', head: true }).eq('active', true),
  ])
  return NextResponse.json({
    articles: articles.count ?? 0,
    drafts: drafts.count ?? 0,
    sources: sources.count ?? 0,
  })
}
