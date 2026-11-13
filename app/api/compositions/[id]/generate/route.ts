import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, unauthorized, requireResearchSchema } from '@/lib/adminAuth'
import { createServiceClient } from '@/lib/supabase/server'
import { checked } from '@/lib/research'
import { DEFAULT_SYNTHESIS_PROMPT, synthesisInput } from '@/lib/synthesis'
import { canonicalSourceUrl, validateSourceCitations } from '@/lib/eventMatching'
import { getOpenAI } from '@/lib/openai'
import { slugify, uniqueSlug } from '@/lib/slugify'
import type { Composition } from '@/lib/researchTypes'
import { randomUUID } from 'node:crypto'

export const maxDuration = 300
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAdmin())) return unauthorized() // CRON_SECRET deliberately confers no generation permission.
  const { id } = await params
  const service = createServiceClient()
  const schemaResponse = await requireResearchSchema(service)
  if (schemaResponse) return schemaResponse
  const body = await req.json().catch(() => ({}))
  const requestId = typeof body.request_id === 'string' ? body.request_id : randomUUID()
  let claimed = false
  try {
    const existing = checked(
      await service
        .from('compositions')
        .select('status,draft_id,generation_request_id')
        .eq('id', id)
        .single()
    )
    if (
      existing &&
      existing.generation_request_id === requestId &&
      existing.draft_id &&
      existing.status === 'ready'
    )
      return NextResponse.json({ draft_id: existing.draft_id })
    claimed = checked(
      await service.rpc('claim_composition_generation', { p_id: id, p_request: requestId })
    )
    if (!claimed)
      return NextResponse.json(
        { error: 'Generation already running, or composition unavailable' },
        { status: 409 }
      )
    const composition = checked(
      await service.from('compositions').select('*,composition_sources(*)').eq('id', id).single()
    ) as Composition
    composition.composition_sources?.sort((a, b) => a.position - b.position)
    if (!composition.angle.trim())
      throw new Error('Add a central question or editorial direction before generating')
    const input = synthesisInput(composition)
    if (input.sources.length < 2 || JSON.stringify(input).length > 220000)
      throw new Error('Select 2–8 sources with a combined evidence size below 220,000 characters')
    const custom = checked(
      await service.from('settings').select('value').eq('key', 'prompt_synthesis').maybeSingle()
    )
    const completion = await getOpenAI().chat.completions.create({
      model: 'gpt-4o',
      response_format: { type: 'json_object' },
      max_tokens: 6500,
      messages: [
        {
          role: 'system',
          content:
            DEFAULT_SYNTHESIS_PROMPT +
            (custom?.value ? `\nAdditional house style:\n${custom.value}` : '')
        },
        { role: 'user', content: JSON.stringify(input) }
      ]
    })
    if (completion.choices[0]?.finish_reason === 'length')
      throw new Error('Article was truncated; shorten the requested scope and try again')
    const output = JSON.parse(completion.choices[0]?.message.content || '{}')
    if (
      typeof output.content !== 'string' ||
      typeof output.title !== 'string' ||
      output.content.length < 500
    )
      throw new Error('Generation did not return a complete article')
    const used = validateSourceCitations(
      output.content,
      input.sources.map((s) => s.url)
    )
    const slug = await uniqueSlug(slugify(output.title), 'drafts', service)
    const usedUrls = input.sources
      .filter((s) => used.has(canonicalSourceUrl(s.url)))
      .map((s) => s.url)
    const draftId = checked(
      await service.rpc('finish_composition_generation', {
        p_id: id,
        p_request: requestId,
        p_title: output.title,
        p_content: output.content,
        p_slug: slug,
        p_urls: usedUrls
      })
    )
    return NextResponse.json({ draft_id: draftId })
  } catch (e) {
    if (claimed)
      await service
        .from('compositions')
        .update({ status: 'failed', last_error: String(e).slice(0, 2000) })
        .eq('id', id)
        .eq('status', 'generating')
        .eq('generation_request_id', requestId)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
