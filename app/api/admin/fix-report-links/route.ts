import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getOpenAI } from '@/lib/openai'
import { articleHref } from '@/lib/contentTaxonomy'
import { revalidateArticleSurfaces } from '@/lib/revalidate'

const BROKEN_LINK_PATTERN = /internal_article_url/i

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.email !== process.env.ADMIN_EMAIL) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const slug: string | undefined = body.slug

  const service = createServiceClient()

  let reportQuery = service
    .from('articles')
    .select('id, slug, title, content, published_at, article_type, content_type, content_slug')
    .eq('article_type', 'monthly-summary')

  reportQuery = slug
    ? reportQuery.eq('slug', slug)
    : reportQuery.ilike('content', `%internal_article_url%`).order('published_at', { ascending: false }).limit(1)

  const { data: reports, error: reportError } = await reportQuery
  if (reportError) return NextResponse.json({ error: reportError.message }, { status: 500 })

  const report = reports?.[0]
  if (!report) {
    return NextResponse.json({ error: slug ? `No monthly report found for slug "${slug}"` : 'No monthly report with broken internal links found' }, { status: 404 })
  }

  if (!BROKEN_LINK_PATTERN.test(report.content)) {
    return NextResponse.json({ error: `Report "${report.slug}" has no broken internal_article_url placeholders.` }, { status: 400 })
  }

  // The report is published on the 1st of the month it summarizes the *previous* month for.
  const publishedAt = new Date(report.published_at)
  const endDate = new Date(publishedAt.getFullYear(), publishedAt.getMonth(), 1)
  const startDate = new Date(publishedAt.getFullYear(), publishedAt.getMonth() - 1, 1)

  const { data: sourceArticles, error: sourceError } = await service
    .from('articles')
    .select('title, publisher, excerpt, slug, published_at, article_type, content_type, content_slug')
    .eq('article_type', 'industry')
    .gte('published_at', startDate.toISOString())
    .lt('published_at', endDate.toISOString())
    .order('published_at', { ascending: true })

  if (sourceError) return NextResponse.json({ error: sourceError.message }, { status: 500 })
  if (!sourceArticles?.length) {
    return NextResponse.json({ error: 'No source articles found for the summarized period — cannot resolve correct links.' }, { status: 404 })
  }

  const linkList = sourceArticles.map((a, i) => (
    `${i + 1}. Title: ${a.title}\n   Publisher: ${a.publisher || 'Unknown'}\n   Internal Link: ${articleHref(a)}\n   Summary: ${a.excerpt || ''}`
  )).join('\n\n')

  const systemPrompt = `You are a precise text-editing tool. You will be given a markdown article and a list of valid internal links. Your ONLY job is to fix broken internal hyperlink targets — do not change anything else.

For every markdown link in the article whose target is broken, empty, or the literal placeholder "internal_article_url" (in any path form, e.g. "internal_article_url" or "/articles/internal_article_url" or a full URL containing it):
- Determine which source article the surrounding anchor text and sentence are actually referring to, using the provided list of valid internal links.
- Replace the link target with that source's exact "Internal Link" value, copied verbatim.
- If you cannot confidently match the link to any article in the list, remove the markdown link syntax entirely but keep the anchor text as plain prose text (do not leave a dangling or guessed link).

Do not alter any other text, wording, punctuation, formatting, headings, or already-correct links. Output ONLY the full corrected article content, with no preamble, no explanation, and no code fences.`

  const userPrompt = `VALID INTERNAL LINKS:\n\n${linkList}\n\nARTICLE CONTENT TO FIX:\n\n${report.content}`

  const openai = getOpenAI()
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    max_tokens: 4096,
    temperature: 0,
  })

  const fixedContent = completion.choices[0].message.content?.trim() ?? ''

  if (!fixedContent || BROKEN_LINK_PATTERN.test(fixedContent)) {
    return NextResponse.json({
      error: 'Repair pass still contains broken placeholder links — not saved. Inspect the output and retry.',
      preview: fixedContent,
    }, { status: 422 })
  }

  const { error: updateError } = await service
    .from('articles')
    .update({ content: fixedContent })
    .eq('id', report.id)

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })

  revalidateArticleSurfaces(report)

  const beforeLinks = report.content.match(/\[[^\]]+\]\([^)]+\)/g) ?? []
  const afterLinks = fixedContent.match(/\[[^\]]+\]\([^)]+\)/g) ?? []

  return NextResponse.json({
    ok: true,
    slug: report.slug,
    title: report.title,
    links_before: beforeLinks,
    links_after: afterLinks,
  })
}
