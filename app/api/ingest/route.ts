import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { fetchFeedResult, fetchArticleSource } from '@/lib/rss'
import { getOpenAI } from '@/lib/openai'
import { DEFAULT_EXTRACTOR_PROMPT, todayLine } from '@/lib/prompts'
import { isGoogleNewsUrl } from '@/lib/rss'
import { loadSeenUrls, rememberSeenUrl } from '@/lib/seenUrls'
import { storeCandidate } from '@/lib/research'
import { canonicalSourceUrl } from '@/lib/eventMatching'
import { isCronRequest, requireResearchSchema } from '@/lib/adminAuth'
import { sourceResult, type IngestSourceResult } from '@/lib/ingestReport'

async function getPrompt(
  supabase: ReturnType<typeof createServiceClient>,
  key: string,
  fallback: string
): Promise<string> {
  try {
    const { data } = await supabase.from('settings').select('value').eq('key', key).single()
    return data?.value || fallback
  } catch {
    return fallback
  }
}

export const maxDuration = 300

export async function GET(req: NextRequest) {
  return POST(req)
}

export async function POST(req: NextRequest) {
  const deadline = Date.now() + 240_000 // Leave headroom inside the 300-second function limit.
  const isCron = isCronRequest(req)

  if (!isCron) {
    const supabase = await createClient()
    const {
      data: { user }
    } = await supabase.auth.getUser()
    if (!user || user.email !== process.env.ADMIN_EMAIL) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const supabase = createServiceClient()
  const schemaResponse = await requireResearchSchema(supabase)
  if (schemaResponse) return schemaResponse
  const { searchParams } = new URL(req.url)
  const sourceFilter =
    searchParams
      .get('sources')
      ?.split(',')
      .map((s) => s.trim())
      .filter(Boolean) ?? []

  let sourcesQuery = supabase.from('rss_sources').select('*').eq('active', true)
  if (sourceFilter.length > 0) sourcesQuery = sourcesQuery.in('id', sourceFilter)
  const { data: allSources, error: sourcesError } = await sourcesQuery
  if (sourcesError) return NextResponse.json({ error: `Could not load RSS sources: ${sourcesError.message}` }, { status: 500 })
  // Podcasts have their own evidence collector and episode baseline.
  const sources = (allSources ?? []).filter((s) => s.kind !== 'podcast')

  if (!sources.length) return NextResponse.json({ processed: 0, skipped: 0, errors: [], source_results: [], complete: true })

  let seen: Set<string>
  try {
    seen = new Set(
      [...(await loadSeenUrls(supabase))].map((url) => {
        try {
          return canonicalSourceUrl(url)
        } catch {
          return url
        }
      })
    )
  } catch (error) {
    // Never spend tokens or create drafts against incomplete history.
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    )
  }

  const openai = getOpenAI()
  const extractorPrompt = await getPrompt(supabase, 'prompt_extractor', DEFAULT_EXTRACTOR_PROMPT)
  let processed = 0
  const errors: string[] = []
  const skipped: string[] = []
  const sourceResults: IngestSourceResult[] = []
  let timeLimitReported = false
  const reportTimeLimit = () => {
    if (!timeLimitReported) errors.push('Collection time limit reached. Unexamined items and sources are reported as deferred; run collection again to continue.')
    timeLimitReported = true
  }

  const maxAgeDays = 30
  const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000)

  for (const source of sources) {
    const result = sourceResult(source)
    sourceResults.push(result)
    if (Date.now() >= deadline) {
      result.status = 'deferred'
      result.error = 'Time limit reached before this feed was read.'
      reportTimeLimit()
      continue
    }
    const { items, error: fetchError } = await fetchFeedResult(source.url)
    result.items = items.length
    // Record the fetch on the source so /admin/sources can tell a dead feed
    // from a quiet one. Report a health-write failure without stopping collection.
    const newest = items.reduce<number | null>((max, i) => {
      const t = i.pubDate ? new Date(i.pubDate).getTime() : NaN
      return isNaN(t) ? max : Math.max(max ?? t, t)
    }, null)
    const { error: healthError } = await supabase
      .from('rss_sources')
      .update({
        last_fetch_at: new Date().toISOString(),
        last_fetch_error: fetchError,
        last_fetch_items: items.length,
        last_fetch_newest_at: newest === null ? null : new Date(newest).toISOString()
      })
      .eq('id', source.id)
    if (healthError) {
      console.warn(
        `[ingest] could not record fetch health for ${source.url}: ${healthError.message}`
      )
      errors.push(`${result.name}: could not record feed health: ${healthError.message}`)
    }
    if (fetchError) {
      const message = fetchError.replaceAll(source.url, '[configured feed URL]')
      result.status = 'error'
      result.error = message
      errors.push(`${result.name}: ${message}`)
      continue // A failed feed is not a quiet feed; other sources and saved research can still proceed.
    }
    const recent = items.filter((i) => {
      if (!i.pubDate) return true // no date → don't filter out
      const pub = new Date(i.pubDate)
      if (isNaN(pub.getTime())) { result.invalid++; return false }
      if (pub < cutoff) { result.old++; return false }
      return true
    })
    const keywords: string[] = (source.keywords ?? []).map((k: string) => k.toLowerCase())
    const matchesKeywords = (text: string) => {
      if (keywords.length === 0) return true
      return keywords.some((k) => text.includes(k))
    }
    const fresh = recent.filter((i) => {
      try {
        if (!i.link) { result.invalid++; return false }
        if (seen.has(canonicalSourceUrl(i.link))) { result.seen++; return false }
        return true
      } catch { result.invalid++; return false }
    })
    console.log(`[ingest] ${source.url}: ${items.length} items, ${fresh.length} unseen within ${maxAgeDays}d`)
    // The outlet to credit: the feed itself, unless it is an aggregator, in
    // which case only the item's own <source> counts (see lib/sourceName.ts).
    const aggregator = isGoogleNewsUrl(source.url)

    let extractionCalls = 0
    for (const [index, item] of fresh.entries()) {
      if (Date.now() >= deadline || extractionCalls >= 15) {
        result.deferred = fresh.length - index
        if (Date.now() >= deadline) { result.status = 'deferred'; reportTimeLimit() }
        break
      }
      // `fresh` was computed before this loop; a feed may repeat a URL.
      if (seen.has(canonicalSourceUrl(item.link))) { result.seen++; continue }
      try {
        // Prefer full article text over RSS snippet — RSS feeds only carry teasers
        const fetchedSource = item.link ? await fetchArticleSource(item.link) : null
        const fetchedText = fetchedSource?.text ?? null
        const originalUrl = fetchedSource?.url || item.link
        if (seen.has(canonicalSourceUrl(originalUrl))) {
          await rememberSeenUrl(supabase, item.link)
          seen.add(canonicalSourceUrl(item.link))
          result.seen++
          continue
        }
        const articleText = fetchedText ?? item.contentSnippet ?? item.content ?? ''

        // Keyword filter runs on full text (title + fetched body) so body-only mentions aren't missed
        const keywordHaystack = `${item.title} ${articleText}`.toLowerCase()
        if (!matchesKeywords(keywordHaystack)) {
          result.keyword_misses++
          console.log(`[ingest] skipping ${item.link}: no keyword match`)
          continue
        }
        console.log(
          `[ingest] article text length for ${item.link}: ${articleText.length} chars${fetchedText ? ' (fetched)' : ' (rss snippet)'}`
        )

        if (articleText.length < 50) {
          result.short_text++
          if (result.rejections.length < 20) result.rejections.push({ url: item.link, reason: 'short_text' })
          console.log(
            `[ingest] skipping ${item.link}: text too short (${articleText.length} chars)`
          )
          skipped.push(item.link)
          seen.add(canonicalSourceUrl(item.link))
          continue
        }

        const outlet =
          aggregator || isGoogleNewsUrl(item.link)
            ? (item.sourceName ?? null)
            : (source.name ?? null)

        const extractInput = [
          todayLine(),
          originalUrl ? `Source URL: ${originalUrl}` : '',
          outlet ? `Published by: ${outlet}` : '',
          `Title: ${item.title}`,
          `Article content:\n${articleText}`
        ]
          .filter(Boolean)
          .join('\n\n')

        // Stage 1: extract facts
        // Only eligible extractor calls use the 15-call budget. Irrelevant or short
        // feed entries must not permanently hide a later relevant article.
        if (Date.now() >= deadline) {
          result.deferred = fresh.length - index
          result.status = 'deferred'
          reportTimeLimit()
          break
        }
        extractionCalls++
        const extractRes = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: extractorPrompt },
            { role: 'user', content: extractInput }
          ]
        }, { timeout: Math.max(1, Math.min(30_000, deadline - Date.now())), maxRetries: 0 })
        const facts = extractRes.choices[0]?.message.content ?? ''

        if (!facts.trim() || facts.trim() === 'UNUSABLE_CONTENT') {
          result.unusable++
          if (result.rejections.length < 20) result.rejections.push({ url: item.link, reason: 'unusable' })
          console.log(`[ingest] UNUSABLE_CONTENT: ${item.link}`)
          skipped.push(item.link)
          await rememberSeenUrl(supabase, item.link)
          seen.add(canonicalSourceUrl(item.link))
          continue
        }

        await storeCandidate(supabase, {
          title: item.title,
          source_url: originalUrl,
          source_name: outlet,
          source_feed_id: source.id,
          source_published_at:
            item.pubDate && !isNaN(Date.parse(item.pubDate))
              ? new Date(item.pubDate).toISOString()
              : null,
          extracted_facts: facts,
          quality: fetchedText ? 'full' : 'snippet'
        })
        seen.add(canonicalSourceUrl(item.link))
        seen.add(canonicalSourceUrl(originalUrl))
        result.collected++
        processed++
        await rememberSeenUrl(supabase, item.link)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`[ingest] Error processing ${item.link}:`, err)
        errors.push(`${item.link}: ${msg}`)
        result.failed++
      }
    }
    console.log(`[ingest] source result: ${JSON.stringify(result)}`)
  }

  return NextResponse.json({ processed, skipped: skipped.length, errors, source_results: sourceResults,
    complete: errors.length === 0 && sourceResults.every(source => source.status !== 'deferred' && source.deferred === 0) })
}
