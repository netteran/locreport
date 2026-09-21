import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getOpenAI } from '@/lib/openai'
import { DEFAULT_EXTRACTOR_PROMPT, DEFAULT_INDUSTRY_PROMPT, todayLine } from '@/lib/prompts'
import { classifyArticle } from '@/lib/classify'

async function getPrompt(key: string, fallback: string): Promise<string> {
  try {
    const supabase = createServiceClient()
    const { data } = await supabase.from('settings').select('value').eq('key', key).single()
    return data?.value || fallback
  } catch {
    return fallback
  }
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.email !== process.env.ADMIN_EMAIL) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json()
  const { stage, articleContent, sourceUrl, extraPrompt, contentType } = body

  const openai = getOpenAI()

  if (stage === 'extract') {
    const extractorPrompt = await getPrompt('prompt_extractor', DEFAULT_EXTRACTOR_PROMPT)
    const userContent = [
      todayLine(),
      sourceUrl ? `Source URL: ${sourceUrl}` : '',
      `Article content:\n${articleContent}`,
    ].filter(Boolean).join('\n\n')

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: extractorPrompt },
        { role: 'user', content: userContent },
      ],
    })
    return NextResponse.json({ facts: completion.choices[0].message.content ?? '' })
  }

  if (stage === 'generate') {
    const { facts, title, sourceName, extraUrl1, extraSourceName1, extraUrl2, extraSourceName2 } = body
    const basePrompt = await getPrompt('prompt_industry', DEFAULT_INDUSTRY_PROMPT)

    const systemPrompt = extraPrompt
      ? `${basePrompt}\n\nADDITIONAL INSTRUCTIONS:\n${extraPrompt}`
      : basePrompt

    const sources = [
      sourceUrl ? { url: sourceUrl, name: sourceName?.trim() || null } : null,
      extraUrl1?.trim() ? { url: extraUrl1.trim(), name: extraSourceName1?.trim() || null } : null,
      extraUrl2?.trim() ? { url: extraUrl2.trim(), name: extraSourceName2?.trim() || null } : null,
    ].filter(Boolean) as { url: string; name: string | null }[]

    const sourcesBlock = sources.length
      ? sources.map((s, i) =>
          `Source ${i + 1}: ${s.name ? `${s.name} — ` : ''}${s.url}`
        ).join('\n')
      : ''

    const userContent = [
      sourcesBlock,
      title ? `Suggested title: ${title}` : '',
      `Extracted facts:\n${facts}`,
    ].filter(Boolean).join('\n\n')

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
    })
    const content = completion.choices[0].message.content ?? ''

    // Extract H1 from content, or generate a title if none present
    let articleTitle = content.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? ''
    if (!articleTitle) {
      const titleCompletion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'Write a concise, compelling article title (no markdown, no quotes, max 12 words). Respond with only the title.' },
          { role: 'user', content: `Generate a title for this article:\n\n${content.slice(0, 800)}` },
        ],
        max_tokens: 60,
      })
      articleTitle = titleCompletion.choices[0].message.content?.trim() ?? ''
    }

    const classification = await classifyArticle(openai, content)
    return NextResponse.json({ content, title: articleTitle, ...classification })
  }

  return NextResponse.json({ error: 'Invalid stage' }, { status: 400 })
}
