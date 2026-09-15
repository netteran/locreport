import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { classifyArticle } from '@/lib/classify'
import { getOpenAI } from '@/lib/openai'
import { revalidateArticleSurfaces } from '@/lib/revalidate'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const slugs: string[] = body.slugs ?? []
  const allMissing: boolean = body.all_missing === true

  if (!slugs.length && !allMissing && !body.all) {
    return NextResponse.json({ error: 'Provide slugs, set all_missing: true, or set all: true' }, { status: 400 })
  }

  const service = createServiceClient()
  const openai = getOpenAI()
  const results: Record<string, string> = {}

  const allArticles: boolean = body.all === true
  const offset: number = body.offset ?? 0
  const batchSize: number = Math.min(body.batch_size ?? 20, 50)

  let articles: { id: string; slug: string; content: string }[] = []

  if (allArticles) {
    const { data, error } = await service
      .from('articles')
      .select('id, slug, content')
      .neq('article_type', 'monthly-summary')
      .order('published_at', { ascending: false })
      .range(offset, offset + batchSize - 1)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    articles = data ?? []
  } else if (allMissing) {
    const { data, error } = await service
      .from('articles')
      .select('id, slug, content')
      .is('impact_score', null)
      .neq('article_type', 'monthly-summary')
      .order('published_at', { ascending: false })
      .limit(20)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    articles = data ?? []
  } else {
    for (const slug of slugs) {
      const { data, error } = await service
        .from('articles')
        .select('id, slug, content')
        .eq('slug', slug)
        .maybeSingle()
      if (error || !data) { results[slug] = 'not found'; continue }
      articles.push(data)
    }
  }

  for (const article of articles) {
    const classification = await classifyArticle(openai, article.content)
    const { error: updateError } = await service
      .from('articles')
      .update({
        impact_score: classification.impact_score,
        time_horizon: classification.time_horizon,
        signal_ids: classification.signal_ids,
        business_implications: classification.business_implications,
        affected_segments: classification.affected_segments,
      })
      .eq('id', article.id)

    results[article.slug] = updateError ? `error: ${updateError.message}` : 'updated'
  }

  // Impact scores and signal tags drive what the intelligence pages list, so a
  // reclassify changes their contents even though no article was published.
  if (Object.values(results).some(r => r === 'updated')) revalidateArticleSurfaces()

  const hasMore = allArticles && articles.length === batchSize
  return NextResponse.json({
    results,
    count: articles.length,
    ...(allArticles && { next_offset: hasMore ? offset + batchSize : null }),
  })
}
