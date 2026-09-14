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
