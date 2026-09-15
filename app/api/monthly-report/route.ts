import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getOpenAI } from '@/lib/openai'
import { slugify, uniqueSlug } from '@/lib/slugify'
import { DEFAULT_MONTHLY_PROMPT } from '@/lib/prompts'
import { embedAndStoreArticle } from '@/lib/embeddings'
import { revalidateArticleSurfaces } from '@/lib/revalidate'

async function getPrompt(): Promise<string> {
  try {
    const supabase = createServiceClient()
    const { data } = await supabase.from('settings').select('value').eq('key', 'prompt_monthly').single()
    return data?.value || DEFAULT_MONTHLY_PROMPT
  } catch {
    return DEFAULT_MONTHLY_PROMPT
  }
}

function getPeriod(): { period: string; year: number; month: number; monthName: string } {
  const now = new Date()
  // Summarise the previous month
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const year = d.getFullYear()
  const month = d.getMonth() + 1
  const monthName = d.toLocaleString('en-US', { month: 'long' })
  return { period: `${year}-${String(month).padStart(2, '0')}`, year, month, monthName }
}

export async function POST(req: NextRequest) {
  // Accept both cron (CRON_SECRET) and admin session auth
  const auth = req.headers.get('Authorization')
  const isCron = auth === `Bearer ${process.env.CRON_SECRET}`

  if (!isCron) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user || user.email !== process.env.ADMIN_EMAIL) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const service = createServiceClient()
  const { period, year, month, monthName } = getPeriod()

  // Check if a monthly report already exists for this period (unless force flag set)
  const body = req.headers.get('content-type')?.includes('application/json')
    ? await req.json().catch(() => ({}))
    : {}
  const force = body?.force === true

  const { data: existing } = await service
    .from('articles')
    .select('id, title')
    .eq('article_type', 'monthly-summary')
    .or(`slug.ilike.%${period}%,title.ilike.%${monthName} ${year}%`)
    .limit(1)

  if (existing?.length && !force) {
    return NextResponse.json({
      error: `Monthly report for ${period} already exists.`,
      existing_id: existing[0].id,
    }, { status: 409 })
  }

  // Fetch last month's industry articles
  const startDate = new Date(year, month - 1, 1).toISOString()
  const endDate = new Date(year, month, 1).toISOString()

  const { data: articles, error: articlesError } = await service
    .from('articles')
    .select('title, source_url, publisher, excerpt, content, slug, published_at')
    .eq('article_type', 'industry')
    .gte('published_at', startDate)
    .lt('published_at', endDate)
    .order('published_at', { ascending: true })

  if (articlesError) {
    return NextResponse.json({ error: articlesError.message }, { status: 500 })
  }

  if (!articles?.length) {
    return NextResponse.json({ error: `No industry articles found for ${period}.` }, { status: 404 })
  }

  // Build article summaries for the prompt
  const articleSummaries = articles.map((a, i) => {
    const internalUrl = `/articles/${a.slug}`
    const summary = a.excerpt || a.content?.slice(0, 500) || ''
    return [
      `${i + 1}. Title: ${a.title}`,
      `   Publisher: ${a.publisher || 'Unknown'}`,
      `   Source: ${a.source_url || 'N/A'}`,
      `   Internal Link: ${internalUrl}`,
      `   Summary: ${summary}`,
    ].join('\n')
  }).join('\n\n')

  const userPrompt = `Create the monthly industry report for ${period} (${monthName} ${year}).\n\n${articleSummaries}`

  const systemPrompt = await getPrompt()
  const openai = getOpenAI()

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    max_tokens: 2400,
    temperature: 0.5,
  })

  const reportContent = completion.choices[0].message.content?.trim() ?? ''
  const titleMatch = reportContent.match(/^#\s+(.+)$/m)
  const title = titleMatch ? titleMatch[1].trim() : `Monthly Report — ${monthName} ${year}`
  const slug = await uniqueSlug(slugify(title), 'articles', service)

  const publishedAt = new Date(year, month, 1).toISOString() // publish on 1st of current month

  const { data: article, error: insertError } = await service
    .from('articles')
    .insert({
      title,
      slug,
      content: reportContent,
      article_type: 'monthly-summary',
      author: 'LocReport Editorial Desk',
      publisher: 'LocReport',
      tags: ['monthly', 'roundup', 'localization'],
      published_at: publishedAt,
    })
    .select()
    .single()

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 })
  }

  await embedAndStoreArticle(service, article.id)
  revalidateArticleSurfaces({ slug, monthlyReport: true })

  return NextResponse.json({ ok: true, period, article_count: articles.length, id: article.id, title })
}
