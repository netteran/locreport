import type { createServiceClient } from '@/lib/supabase/server'
import { isGoogleNewsUrl } from '@/lib/rss'

type Service = ReturnType<typeof createServiceClient>

/**
 * The name an article should credit for its source: the outlet that published
 * the story, never the feed we found it through.
 *
 * Ordinary feeds are the publisher, so their `rss_sources.name` is right. A
 * Google News source is not — its name ("Google News – Platforms") is our own
 * label for a search query — so for those only `drafts.source_name` (the
 * outlet from the item's `<source>` tag, stored at ingest) counts. Null means
 * "unknown": callers must not fall back to the feed name.
 */
export async function draftSourceName(
  supabase: Service,
  draft: { source_name?: string | null; source_feed_id?: string | null; source_url?: string | null }
): Promise<string | null> {
  const stored = draft.source_name?.trim()
  if (stored) return stored
  if (!draft.source_feed_id || isGoogleNewsUrl(draft.source_url)) return null

  const { data: feed } = await supabase
    .from('rss_sources')
    .select('name, url')
    .eq('id', draft.source_feed_id)
    .maybeSingle()
  if (!feed || isGoogleNewsUrl(feed.url)) return null
  return feed.name ?? null
}

/**
 * The "Source name:" line of a Stage 2 prompt. When the outlet is unknown and
 * the item came through an aggregator, say so explicitly — the industry prompt
 * otherwise reaches for whatever name is nearest, which was the feed label.
 * Lives in the user message, not the system prompt, so it holds even when the
 * prompt has been overridden from /admin/prompts.
 */
export function sourceNameLine(sourceName: string | null, sourceUrl: string | null | undefined): string {
  if (sourceName) return `Source name: ${sourceName}`
  if (isGoogleNewsUrl(sourceUrl)) {
    return 'Source name: unknown — this item reached us through Google News, which is an aggregator, not the publisher. ' +
      'Credit the original publishing outlet as named in the extracted facts; if no outlet is named, cite it as "the original report". ' +
      'Never cite "Google News" or any feed name as the source.'
  }
  return ''
}
