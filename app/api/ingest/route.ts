import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { fetchFeedResult, fetchArticleSource } from '@/lib/rss'
import { getOpenAI } from '@/lib/openai'
import { DEFAULT_EXTRACTOR_PROMPT, todayLine } from '@/lib/prompts'
import { isGoogleNewsUrl } from '@/lib/rss'
import { loadSeenUrls, rememberSeenUrl } from '@/lib/seenUrls'
import { storeCandidate } from '@/lib/research'
import { canonicalSourceUrl } from '@/lib/eventMatching'
import { isCronRequest } from '@/lib/adminAuth'

async function getPrompt(supabase: ReturnType<typeof createServiceClient>, key: string, fallback: string): Promise<string> {
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
  const isCron = isCronRequest(req)

  if (!isCron) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user || user.email !== process.env.ADMIN_EMAIL) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const supabase = createServiceClient()
  const { searchParams } = new URL(req.url)
  const sourceFilter = searchParams.get('sources')?.split(',').map(s => s.trim()).filter(Boolean) ?? []

  let sourcesQuery = supabase.from('rss_sources').select('*').eq('active', true)
  if (sourceFilter.length > 0) sourcesQuery = sourcesQuery.in('id', sourceFilter)
  const { data: allSources } = await sourcesQuery
  // Podcasts have their own evidence collector and episode baseline.
  const sources = (allSources ?? []).filter(s => s.kind !== 'podcast')

  if (!sources.length) return NextResponse.json({ processed: 0 })

  let seen: Set<string>
  try {
    seen = new Set([...await loadSeenUrls(supabase)].map(url => { try { return canonicalSourceUrl(url) } catch { return url } }))
  } catch (error) {
    // Never spend tokens or create drafts against incomplete history.
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }

  const openai = getOpenAI()
  const extractorPrompt = await getPrompt(supabase, 'prompt_extractor', DEFAULT_EXTRACTOR_PROMPT)
  let processed = 0
  const errors: string[] = []
  const skipped: string[] = []

  const maxAgeDays = 30
  const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000)

  for (const source of sources) {
    const { items, error: fetchError } = await fetchFeedResult(source.url)
    // Record the fetch on the source so /admin/sources can tell a dead feed
    // from a quiet one. Never fails the run (e.g. before the migration lands).
    const newest = items.reduce<number | null>((max, i) => {
      const t = i.pubDate ? new Date(i.pubDate).getTime() : NaN
      return isNaN(t) ? max : Math.max(max ?? t, t)
    }, null)
    const { error: healthError } = await supabase.from('rss_sources').update({
      last_fetch_at: new Date().toISOString(),
      last_fetch_error: fetchError,
      last_fetch_items: items.length,
      last_fetch_newest_at: newest === null ? null : new Date(newest).toISOString(),
    }).eq('id', source.id)
    if (healthError) console.warn(`[ingest] could not record fetch health for ${source.url}: ${healthError.message}`)
    const recent = items.filter(i => {
      if (!i.pubDate) return true // no date → don't filter out
      const pub = new Date(i.pubDate)
      return !isNaN(pub.getTime()) && pub >= cutoff
    })
    console.log(`[ingest] ${source.url}: ${items.length} items, ${recent.filter(i => i.link && !seen.has(canonicalSourceUrl(i.link))).length} fresh within ${maxAgeDays}d`)
    const keywords: string[] = (source.keywords ?? []).map((k: string) => k.toLowerCase())
    const matchesKeywords = (text: string) => {
      if (keywords.length === 0) return true
      return keywords.some(k => text.includes(k))
    }
    const fresh = recent.filter(i => i.link && !seen.has(canonicalSourceUrl(i.link))).slice(0, 15)
    // The outlet to credit: the feed itself, unless it is an aggregator, in
    // which case only the item's own <source> counts (see lib/sourceName.ts).
    const aggregator = isGoogleNewsUrl(source.url)

    for (const item of fresh) {
      // `fresh` was computed before this loop; a feed may repeat a URL.
      if (seen.has(canonicalSourceUrl(item.link))) continue
      try {
        // Prefer full article text over RSS snippet — RSS feeds only carry teasers
        const fetchedSource = item.link ? await fetchArticleSource(item.link) : null
        const fetchedText = fetchedSource?.text ?? null
        const originalUrl = fetchedSource?.url || item.link
        if (seen.has(canonicalSourceUrl(originalUrl))) {
          await rememberSeenUrl(supabase,item.link)
          seen.add(canonicalSourceUrl(item.link))
          continue
        }
        const articleText = fetchedText ?? item.contentSnippet ?? item.content ?? ''

        // Keyword filter runs on full text (title + fetched body) so body-only mentions aren't missed
        const keywordHaystack = `${item.title} ${articleText}`.toLowerCase()
        if (!matchesKeywords(keywordHaystack)) {
          console.log(`[ingest] skipping ${item.link}: no keyword match`)
          continue
        }
        console.log(`[ingest] article text length for ${item.link}: ${articleText.length} chars${fetchedText ? ' (fetched)' : ' (rss snippet)'}`)

        if (articleText.length < 50) {
          console.log(`[ingest] skipping ${item.link}: text too short (${articleText.length} chars)`)
          skipped.push(item.link)
          seen.add(canonicalSourceUrl(item.link))
          continue
        }

        const outlet = aggregator || isGoogleNewsUrl(item.link)
          ? (item.sourceName ?? null)
          : (source.name ?? null)

        const extractInput = [
          todayLine(),
          originalUrl ? `Source URL: ${originalUrl}` : '',
          outlet ? `Published by: ${outlet}` : '',
          `Title: ${item.title}`,
          `Article content:\n${articleText}`,
        ].filter(Boolean).join('\n\n')

        // Stage 1: extract facts
        const extractRes = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: extractorPrompt },
            { role: 'user', content: extractInput },
          ],
        })
        const facts = extractRes.choices[0].message.content ?? ''

        if (!facts.trim() || facts.trim() === 'UNUSABLE_CONTENT') {
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
          source_published_at: item.pubDate && !isNaN(Date.parse(item.pubDate)) ? new Date(item.pubDate).toISOString() : null,
          extracted_facts: facts,
          quality: fetchedText ? 'full' : 'snippet',
        })
        seen.add(canonicalSourceUrl(item.link))
        seen.add(canonicalSourceUrl(originalUrl))
        await rememberSeenUrl(supabase, item.link)
        processed++

      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`[ingest] Error processing ${item.link}:`, err)
        errors.push(`${item.link}: ${msg}`)
      }
    }
  }

  return NextResponse.json({ processed, skipped: skipped.length, errors })
}
