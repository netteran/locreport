import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getOpenAI } from '@/lib/openai'
import { DEFAULT_EXTRACTOR_PROMPT, DEFAULT_INDUSTRY_PROMPT, todayLine } from '@/lib/prompts'
import { getDirectoryEntries, linkifyCompanyMentions } from '@/lib/companyLinks'
import { isYouTubeUrl, parsePodcastConfig, writePodcastArticle, type PodcastConfig } from '@/lib/podcast'

type Params = { params: Promise<{ id: string }> }

// Guard rail on the reviewer-supplied Stage 2 note — long enough for real editorial
// direction, short enough that it can't crowd out the system prompt.
const MAX_INSTRUCTION_LENGTH = 2000

async function getPrompt(key: string, fallback: string): Promise<string> {
  try {
    const supabase = createServiceClient()
    const { data } = await supabase.from('settings').select('value').eq('key', key).single()
    return data?.value || fallback
  } catch {
    return fallback
  }
}

// Wraps the reviewer's note so it reads as a directive over the house style prompt,
// while restating that the fact sheet is off limits.
function buildInstructionMessage(instruction: string): string {
  return [
    'ADDITIONAL EDITORIAL INSTRUCTION FOR THIS RE-RUN.',
    'It applies to the shape, angle, emphasis, structure and length of the write-up only, and takes precedence over the style guidance above wherever the two conflict.',
    'The extracted facts below are fixed and already verified: do not add, drop, soften, sharpen, re-date, re-attribute or invent any fact, number, name, quote or milestone in order to satisfy this instruction. If the instruction cannot be followed without changing a fact, follow it only as far as the facts allow.',
    '',
    instruction,
  ].join('\n')
}

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.email !== process.env.ADMIN_EMAIL) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Optional body — a plain "re-run as is" may send nothing at all.
  let instruction = ''
  try {
    const body = await req.json()
    if (typeof body?.instruction === 'string') instruction = body.instruction.trim()
  } catch {
    // no/invalid body — treat as an unmodified re-run
  }
  if (instruction.length > MAX_INSTRUCTION_LENGTH) {
    return NextResponse.json(
      { error: `Instruction too long (${instruction.length} chars, max ${MAX_INSTRUCTION_LENGTH}).` },
      { status: 400 },
    )
  }

  const service = createServiceClient()

  const { data: draft, error: fetchError } = await service
    .from('drafts').select('*').eq('id', id).single()
  if (fetchError || !draft) {
    return NextResponse.json({ error: 'Draft not found' }, { status: 404 })
  }

  if (!draft.content) {
    return NextResponse.json({ error: 'Draft has no content to re-run' }, { status: 400 })
  }

  let sourceName: string | null = null
  let podcastConfig: PodcastConfig | null = null
  if (draft.source_feed_id) {
    const { data: feed } = await service
      .from('rss_sources').select('*').eq('id', draft.source_feed_id).single()
    sourceName = feed?.name ?? null
    if (feed?.kind === 'podcast') {
      const parsed = parsePodcastConfig(feed.podcast_config)
      if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
      podcastConfig = parsed.config
      // Never re-extract a podcast draft: the transcript isn't stored, and the
      // news extractor run over the draft's own prose would only degrade it.
      if (typeof draft.extracted_facts !== 'string' || !draft.extracted_facts.trim()) {
        return NextResponse.json({ error: 'Podcast draft has no stored episode notes to re-run from' }, { status: 400 })
      }
    }
  }

  // Mark as rerunning
  await service.from('drafts').update({ status: 'rerunning' }).eq('id', id)

  try {
    const openai = getOpenAI()

    // Stage 1: reuse the fact sheet the draft was built from. A re-run re-profiles the
    // prose, so re-extracting would let the facts drift — and on a draft that has already
    // been generated, the only text left to extract from is Stage 2's own output.
    let facts = typeof draft.extracted_facts === 'string' ? draft.extracted_facts.trim() : ''
    const factsReused = facts.length > 0

    if (!factsReused) {
      const extractorPrompt = await getPrompt('prompt_extractor', DEFAULT_EXTRACTOR_PROMPT)
      const extractInput = [
        todayLine(),
        draft.source_url ? `Source URL: ${draft.source_url}` : '',
        `Article content:\n${draft.content}`,
      ].filter(Boolean).join('\n\n')

      const extractRes = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: extractorPrompt },
          { role: 'user', content: extractInput },
        ],
      })
      facts = (extractRes.choices[0].message.content ?? '').trim()
    }

    // Podcast drafts re-run through the podcast writer so the episode format
    // and the allow-listed LinkedIn/Spotify/YouTube links survive the re-run.
    if (podcastConfig) {
      const { title, content } = await writePodcastArticle(openai, service, podcastConfig, {
        episodeTitle: draft.title,
        episodeYouTubeUrl: draft.source_url && isYouTubeUrl(draft.source_url) ? draft.source_url : null,
        notes: facts,
        instruction,
      })
      const newContent = linkifyCompanyMentions(content, await getDirectoryEntries(service))
      const { data: updated, error: updateError } = await service
        .from('drafts')
        .update({ title, content: newContent, status: 'rerun' })
        .eq('id', id)
        .select()
        .single()
      if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })
      return NextResponse.json({ ...updated, facts_reused: true })
    }

    // Stage 2: generate article
    const basePrompt = await getPrompt('prompt_industry', DEFAULT_INDUSTRY_PROMPT)

    const generateInput = [
      draft.source_url ? `Source URL: ${draft.source_url}` : '',
      sourceName ? `Source name: ${sourceName}` : '',
      `Suggested title: ${draft.title}`,
      `Extracted facts:\n${facts}`,
    ].filter(Boolean).join('\n\n')

    const generateRes = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system' as const, content: basePrompt },
        ...(instruction
          ? [{ role: 'system' as const, content: buildInstructionMessage(instruction) }]
          : []),
        { role: 'user' as const, content: generateInput },
      ],
    })
    const rawNewContent = generateRes.choices[0].message.content ?? ''
    const directoryEntries = await getDirectoryEntries(service)
    const newContent = linkifyCompanyMentions(rawNewContent, directoryEntries)

    const { data: updated, error: updateError } = await service
      .from('drafts')
      .update({
        content: newContent,
        status: 'rerun',
        // Pin the fact sheet on first re-run so every later re-run profiles the same facts.
        ...(factsReused ? {} : { extracted_facts: facts }),
      })
      .eq('id', id)
      .select()
      .single()

    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })
    return NextResponse.json({ ...updated, facts_reused: factsReused })

  } catch (err) {
    await service.from('drafts').update({ status: 'pending' }).eq('id', id)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Generation failed' }, { status: 500 })
  }
}
