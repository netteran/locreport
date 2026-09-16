import type { createServiceClient } from '@/lib/supabase/server'
import { getOpenAI } from '@/lib/openai'
import { DEFAULT_FACTFLOW_PROMPT, DEFAULT_EXTRACTOR_PROMPT } from '@/lib/prompts'
import { parseHeadlineFact } from '@/lib/facts'

type Service = ReturnType<typeof createServiceClient>

/**
 * Fact Flow publishes exactly one fact per article — the single most important
 * thing that happened — and it is published automatically, without an editor
 * having to ask for it.
 *
 * Everything that creates an article funnels through `ensureArticleFact`, so
 * "this article is live" and "this article has a Fact Flow entry" become the
 * same event. Before this existed the two were separate: ingest distilled facts
 * onto the *draft* and approval merely linked them, so whenever distillation
 * came back empty the article published with nothing on Fact Flow and no error
 * anywhere. 19 of the 238 articles published after Fact Flow launched had no
 * fact at all for that reason.
 */

export type EnsureFactResult =
  | { status: 'exists'; count: number }
  | { status: 'promoted'; content: string }
  | { status: 'created'; content: string }
  | { status: 'skipped'; reason: string }

async function getPrompt(supabase: Service, key: string, fallback: string): Promise<string> {
  try {
    const { data } = await supabase.from('settings').select('value').eq('key', key).single()
    return data?.value || fallback
  } catch {
    return fallback
  }
}

/**
 * Run the Fact Flow prompt over a Stage 1 fact sheet and return the one
 * headline fact, or null if the model found nothing publishable.
 */
export async function distillHeadlineFact(supabase: Service, factSheet: string): Promise<string | null> {
  if (!factSheet?.trim()) return null
  const openai = getOpenAI()
  const prompt = await getPrompt(supabase, 'prompt_factflow', DEFAULT_FACTFLOW_PROMPT)
  const res = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: prompt },
      { role: 'user', content: factSheet },
    ],
  })
  return parseHeadlineFact(res.choices[0].message.content ?? '')
}

/**
 * Derive a fact sheet from raw article prose, for articles that never went
 * through ingest's Stage 1 (manually composed pieces, backfills of anything
 * published before Fact Flow existed).
 */
async function extractFactSheet(supabase: Service, title: string, content: string, sourceUrl: string | null) {
  const openai = getOpenAI()
  const prompt = await getPrompt(supabase, 'prompt_extractor', DEFAULT_EXTRACTOR_PROMPT)
  const res = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: prompt },
      {
        role: 'user',
        content: [
          sourceUrl ? `Source URL: ${sourceUrl}` : '',
          `Title: ${title}`,
          `Article content:\n${content}`,
        ].filter(Boolean).join('\n\n'),
      },
    ],
  })
  const raw = res.choices[0].message.content ?? ''
  return raw.trim() === 'UNUSABLE_CONTENT' ? null : raw
}

export interface EnsureArticleFactInput {
  articleId: string
  title: string
  /** Published article body, used when no Stage 1 fact sheet is available. */
  content?: string | null
  sourceUrl?: string | null
  sourceName?: string | null
  /** The draft this article came from, if any — its facts get promoted first. */
  draftId?: string | null
  /** Stage 1 fact sheet (`drafts.extracted_facts`), preferred over re-extraction. */
  factSheet?: string | null
  /**
   * Timestamp for the fact. Defaults to now. Backfills pass the article's
   * publication date so old articles slot into Fact Flow chronologically
   * instead of landing at the top of the stream as if they were breaking news.
   */
  createdAt?: string | null
}

/**
 * Guarantee that one article has exactly one published Fact Flow fact.
 *
 * Idempotent: an article that already has a fact is left alone, so re-approving
 * a draft or re-running a backfill never duplicates or overwrites. Never
 * throws — publishing an article must not fail because the fact step did — so
 * callers get a status back and failures land in the logs.
 */
export async function ensureArticleFact(
  supabase: Service,
  input: EnsureArticleFactInput
): Promise<EnsureFactResult> {
  const { articleId, title, content, sourceUrl, sourceName, draftId, factSheet, createdAt } = input

  try {
    // Already published a fact for this article — nothing to do.
    const { count } = await supabase
      .from('facts')
      .select('id', { count: 'exact', head: true })
      .eq('article_id', articleId)

    if ((count ?? 0) > 0) return { status: 'exists', count: count ?? 0 }

    // Ingest distils facts onto the draft before the article exists. If one is
    // already sitting there, promote it rather than paying for a second
    // distillation of the same source material.
    if (draftId) {
      const { data: pending } = await supabase
        .from('facts')
        .select('id, content')
        .eq('draft_id', draftId)
        .is('article_id', null)
        .order('created_at', { ascending: true })
        .limit(1)

      const candidate = pending?.[0]
      if (candidate) {
        const { error } = await supabase
          .from('facts')
          .update({ article_id: articleId })
          .eq('id', candidate.id)
        if (error) {
          console.error(`[factflow] could not promote draft fact for article ${articleId}:`, error)
        } else {
          return { status: 'promoted', content: candidate.content }
        }
      }
    }

    // No fact yet — distil one. Prefer the pinned Stage 1 sheet so the fact is
    // drawn from the same material the article was written from.
    let sheet = factSheet?.trim() || null
    if (!sheet && content && content.trim().length >= 200) {
      sheet = await extractFactSheet(supabase, title, content, sourceUrl ?? null)
    }

    if (!sheet) return { status: 'skipped', reason: 'no fact sheet and no usable article text' }

    const headline = await distillHeadlineFact(supabase, sheet)
    if (!headline) return { status: 'skipped', reason: 'distillation returned no publishable fact' }

    const row: Record<string, unknown> = {
      content: headline,
      category: 'news',
      source_url: sourceUrl ?? null,
      source_name: sourceName ?? null,
      article_id: articleId,
      draft_id: draftId ?? null,
    }
    if (createdAt) row.created_at = createdAt

    const { error } = await supabase.from('facts').insert(row)
    if (error) {
      console.error(`[factflow] insert failed for article ${articleId}:`, error)
      return { status: 'skipped', reason: error.message }
    }

    return { status: 'created', content: headline }
  } catch (err) {
    console.error(`[factflow] ensureArticleFact failed for article ${articleId}:`, err)
    return { status: 'skipped', reason: err instanceof Error ? err.message : String(err) }
  }
}

/** One fact as the review screen needs to see it. */
export interface DraftFact {
  id: string
  content: string
  source_url: string | null
  source_name: string | null
  article_id: string | null
  created_at: string
}

/**
 * The fact belonging to one draft, as the reviewer should see it.
 *
 * A draft has at most one, but the column is a plain FK rather than a unique
 * constraint, so this picks deliberately: the fact still waiting on the draft
 * first, falling back to the one already promoted onto the published article so
 * that editing after approval lands on the live sentence instead of silently
 * creating a second, invisible one.
 */
export async function findDraftFact(supabase: Service, draftId: string): Promise<DraftFact | null> {
  const { data, error } = await supabase
    .from('facts')
    .select('id, content, source_url, source_name, article_id, created_at')
    .eq('draft_id', draftId)
    .order('created_at', { ascending: true })

  if (error) {
    console.error(`[factflow] could not read facts for draft ${draftId}:`, error)
    return null
  }

  const rows = (data ?? []) as DraftFact[]
  return rows.find(r => r.article_id === null) ?? rows[0] ?? null
}

export interface SaveDraftFactInput {
  draftId: string
  /**
   * The sentence the reviewer signed off. `undefined` leaves the fact alone;
   * empty removes an unpublished one.
   */
  content: string | null | undefined
  sourceUrl?: string | null
  sourceName?: string | null
}

export interface SaveDraftFactResult {
  status: 'created' | 'updated' | 'deleted' | 'unchanged' | 'refused' | 'failed'
  /** The touched fact is already public, so the caller must turn over the caches. */
  published: boolean
  factId?: string
  content?: string
  reason?: string
}

/** Source attribution for a hand-written fact, taken from the draft it belongs to. */
async function resolveDraftSource(supabase: Service, draftId: string, input: SaveDraftFactInput) {
  if (input.sourceUrl !== undefined && input.sourceName !== undefined) {
    return { sourceUrl: input.sourceUrl ?? null, sourceName: input.sourceName ?? null }
  }

  const { data: draft } = await supabase
    .from('drafts')
    .select('source_url, source_feed_id')
    .eq('id', draftId)
    .maybeSingle()

  let sourceName = input.sourceName ?? null
  if (!sourceName && draft?.source_feed_id) {
    const { data: feed } = await supabase
      .from('rss_sources')
      .select('name')
      .eq('id', draft.source_feed_id)
      .maybeSingle()
    sourceName = feed?.name ?? null
  }

  return {
    sourceUrl: input.sourceUrl !== undefined ? input.sourceUrl : (draft?.source_url ?? null),
    sourceName,
  }
}

/**
 * Write the reviewer's version of a draft's Fact Flow fact.
 *
 * The fact is reviewed on the draft screen and published by the ordinary
 * approval path: this only ever writes it *parked* on the draft (`draft_id` set,
 * `article_id` null), so `ensureArticleFact` promotes whatever the reviewer
 * approved, exactly as it promotes ingest's own distillation. Nothing here
 * publishes a fact on its own.
 *
 * Never throws — an edit to the sentence must not be able to fail a publish —
 * so callers get a status back and failures land in the logs.
 */
export async function saveDraftFact(
  supabase: Service,
  input: SaveDraftFactInput
): Promise<SaveDraftFactResult> {
  const { draftId } = input
  if (input.content === undefined) return { status: 'unchanged', published: false }

  // One wire sentence: newlines the reviewer left behind would render as spaces
  // on /fact-flow anyway, so collapse them before they reach the database.
  const content = (input.content ?? '').replace(/\s+/g, ' ').trim()

  try {
    const existing = await findDraftFact(supabase, draftId)
    const published = !!existing?.article_id

    if (!content) {
      if (!existing) return { status: 'unchanged', published: false }
      // Never pull a live fact off a published article. Fact Flow's guarantee is
      // one fact per article, and ensureArticleFact only runs at publish time —
      // so deleting this one would leave a hole nothing refills.
      if (published) {
        return {
          status: 'refused',
          published: true,
          factId: existing.id,
          reason: 'This fact is already published with the article — edit the sentence rather than clearing it.',
        }
      }
      const { error } = await supabase.from('facts').delete().eq('id', existing.id)
      if (error) {
        console.error(`[factflow] could not delete fact for draft ${draftId}:`, error)
        return { status: 'failed', published: false, reason: error.message }
      }
      return { status: 'deleted', published: false, factId: existing.id }
    }

    if (existing) {
      if (existing.content === content) {
        return { status: 'unchanged', published, factId: existing.id, content }
      }
      const { error } = await supabase.from('facts').update({ content }).eq('id', existing.id)
      if (error) {
        console.error(`[factflow] could not update fact ${existing.id}:`, error)
        return { status: 'failed', published, reason: error.message }
      }
      return { status: 'updated', published, factId: existing.id, content }
    }

    // Nothing parked on the draft — the reviewer wrote the fact by hand, or
    // ingest's distillation came back empty. Park it so approval promotes it.
    const { sourceUrl, sourceName } = await resolveDraftSource(supabase, draftId, input)
    const { data, error } = await supabase
      .from('facts')
      .insert({
        content,
        category: 'news',
        source_url: sourceUrl,
        source_name: sourceName,
        draft_id: draftId,
      })
      .select('id')
      .single()

    if (error) {
      console.error(`[factflow] could not insert fact for draft ${draftId}:`, error)
      return { status: 'failed', published: false, reason: error.message }
    }
    return { status: 'created', published: false, factId: data.id, content }
  } catch (err) {
    console.error(`[factflow] saveDraftFact failed for draft ${draftId}:`, err)
    return { status: 'failed', published: false, reason: err instanceof Error ? err.message : String(err) }
  }
}
