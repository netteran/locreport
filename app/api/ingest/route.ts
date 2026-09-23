import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { fetchFeed, fetchArticleText } from '@/lib/rss'
import { getOpenAI } from '@/lib/openai'
import { slugify, uniqueSlug } from '@/lib/slugify'
import { DEFAULT_EXTRACTOR_PROMPT, DEFAULT_INDUSTRY_PROMPT, todayLine } from '@/lib/prompts'
import { classifyArticle } from '@/lib/classify'
import { extractTeaser } from '@/lib/utils'
import { distillHeadlineFact } from '@/lib/factFlow'
import { getDirectoryEntries, linkifyCompanyMentions } from '@/lib/companyLinks'
import { approveDraft } from '@/lib/publish'

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
  const auth = req.headers.get('Authorization')
  const isCron = auth === `Bearer ${process.env.CRON_SECRET}`

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
  // Podcast sources are manual-only (/api/podcasts/[id]/ingest): transcribing an
  // episode costs real tokens, so neither the schedule nor a batch button may
  // touch them. Filtered here rather than in SQL so this still works before the
  // `kind` column exists.
  const sources = (allSources ?? []).filter(s => s.kind !== 'podcast')

  if (!sources.length) return NextResponse.json({ processed: 0 })

  const { data: existingDrafts } = await supabase
    .from('drafts')
    .select('source_url')
    .not('source_url', 'is', null)

  const seen = new Set((existingDrafts ?? []).map(d => d.source_url))

  const { data: existingArticles } = await supabase
    .from('articles')
    .select('source_url')
    .not('source_url', 'is', null)

  ;(existingArticles ?? []).forEach(a => seen.add(a.source_url))

  // Also check seen_urls table (imported from Jekyll seen.json)
  const { data: seenUrls } = await supabase.from('seen_urls').select('url')
  ;(seenUrls ?? []).forEach(r => seen.add(r.url))

  const openai = getOpenAI()
  const extractorPrompt = await getPrompt(supabase, 'prompt_extractor', DEFAULT_EXTRACTOR_PROMPT)
  const industryPrompt = await getPrompt(supabase, 'prompt_industry', DEFAULT_INDUSTRY_PROMPT)
  const directoryEntries = await getDirectoryEntries(supabase)
  let processed = 0
  const errors: string[] = []
  const skipped: string[] = []

  const maxAgeDays = 30
  const cutoff = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000)

  for (const source of sources) {
    const items = await fetchFeed(source.url)
    const recent = items.filter(i => {
      if (!i.pubDate) return true // no date → don't filter out
      const pub = new Date(i.pubDate)
      return !isNaN(pub.getTime()) && pub >= cutoff
    })
    console.log(`[ingest] ${source.url}: ${items.length} items, ${recent.filter(i => i.link && !seen.has(i.link)).length} fresh within ${maxAgeDays}d`)
    const keywords: string[] = (source.keywords ?? []).map((k: string) => k.toLowerCase())
    const matchesKeywords = (text: string) => {
      if (keywords.length === 0) return true
      return keywords.some(k => text.includes(k))
    }
    const fresh = recent.filter(i => i.link && !seen.has(i.link)).slice(0, 15)

    for (const item of fresh) {
      try {
        // Prefer full article text over RSS snippet — RSS feeds only carry teasers
        const fetchedText = item.link ? await fetchArticleText(item.link) : null
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
          seen.add(item.link)
          continue
        }

        const extractInput = [
          todayLine(),
          item.link ? `Source URL: ${item.link}` : '',
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

        if (facts.trim() === 'UNUSABLE_CONTENT') {
          console.log(`[ingest] UNUSABLE_CONTENT: ${item.link}`)
          skipped.push(item.link)
          seen.add(item.link)
          continue
        }

        // Stage 2: generate article
        const generateInput = [
          item.link ? `Source URL: ${item.link}` : '',
          source.name ? `Source name: ${source.name}` : '',
          `Suggested title: ${item.title}`,
          `Extracted facts:\n${facts}`,
        ].filter(Boolean).join('\n\n')

        const generateRes = await openai.chat.completions.create({
          model: 'gpt-4o',
          messages: [
            { role: 'system', content: industryPrompt },
            { role: 'user', content: generateInput },
          ],
        })
        const rawContent = generateRes.choices[0].message.content ?? ''
        const titleMatch = rawContent.match(/^#\s+(.+)$/m)
        const title = titleMatch ? titleMatch[1].trim() : item.title
        // Strip the H1 from the body — title is stored separately
        const strippedContent = rawContent.replace(/^#\s+.+\n?/, '').trimStart()
        const excerpt = extractTeaser(strippedContent) || null
        const slug = await uniqueSlug(slugify(title), 'drafts', supabase)

        const classification = await classifyArticle(openai, strippedContent)
        // Auto-link mentions of directory companies to their /compass/directory page
        const content = linkifyCompanyMentions(strippedContent, directoryEntries)

        const { error: insertError } = await supabase.from('drafts').insert({
          title,
          slug,
          content,
          excerpt,
          source_url: item.link,
          source_feed_id: source.id,
          source_published_at: item.pubDate ? new Date(item.pubDate).toISOString() : null,
          status: 'pending',
          ai_impact_score: classification.impact_score,
          ai_time_horizon: classification.time_horizon,
          ai_signal_ids: classification.signal_ids,
        })

        if (insertError) {
          console.error(`[ingest] DB insert failed for ${item.link}:`, insertError)
          errors.push(`${item.link}: ${insertError.message}`)
        } else {
          // Save extracted facts linked to the draft
          const { data: draftRow } = await supabase
            .from('drafts')
            .select('id')
            .eq('source_url', item.link)
            .order('created_at', { ascending: false })
            .limit(1)
            .single()

          if (draftRow?.id) {
            // Pin the Stage 1 fact sheet to the draft so a re-run can re-profile the prose
            // against the original facts instead of re-extracting from its own output.
            const { error: factsError } = await supabase
              .from('drafts')
              .update({ extracted_facts: facts })
              .eq('id', draftRow.id)
            if (factsError) {
              console.error(`[ingest] could not store extracted facts for ${item.link}:`, factsError)
            }

            // Fact Flow carries one fact per article — the most important one.
            // It is distilled here, off the pristine Stage 1 sheet, and stays
            // parked on the draft until approval promotes it onto the article.
            // If this comes back empty the approval step distils again rather
            // than publishing the article with nothing on Fact Flow.
            const headline = await distillHeadlineFact(supabase, facts)
            if (headline) {
              const { error: factError } = await supabase.from('facts').insert({
                content: headline,
                category: 'news',
                source_url: item.link,
                source_name: source.name,
                draft_id: draftRow.id,
              })
              if (factError) {
                console.error(`[ingest] fact insert failed for ${item.link}:`, factError)
              }
            } else {
              console.warn(`[ingest] no publishable fact distilled for ${item.link}`)
            }

            // Trusted sources skip /admin/drafts entirely: approve immediately
            // through the exact same path a human click would take (lib/publish.ts),
            // rather than leaving the draft pending.
            if (source.auto_publish) {
              const result = await approveDraft(supabase, draftRow.id)
              if (result.status === 'ok') {
                await supabase.from('drafts').update({ status: 'approved' }).eq('id', draftRow.id)
              } else {
                console.error(`[ingest] auto-publish failed for draft ${draftRow.id}: ${result.message}`)
              }
            }
          }

          seen.add(item.link)
          processed++
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`[ingest] Error processing ${item.link}:`, err)
        errors.push(`${item.link}: ${msg}`)
      }
    }
  }

  return NextResponse.json({ processed, skipped: skipped.length, errors })
}
