import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { fetchArticleText } from '@/lib/rss'
import { ensureArticleFact } from '@/lib/factFlow'

export const maxDuration = 300

// Monthly reports are syntheses of facts Fact Flow has already carried, and the
// Fact Flow prompt bans meta-commentary about reports outright — so they are not
// part of the one-fact-per-article guarantee.
const EXCLUDED_TYPES = ['monthly-summary']

const BATCH_LIMIT = 10

type ArticleRow = {
  id: string
  title: string
  content: string | null
  source_url: string | null
  slug: string
  draft_id: string | null
  published_at: string | null
}

const ARTICLE_COLUMNS = 'id, title, content, source_url, slug, draft_id, published_at'

/**
 * Give one article its Fact Flow fact, reusing the draft's pinned Stage 1 sheet
 * where there is one and re-fetching the source article text where there isn't.
 */
async function backfillOne(svc: ReturnType<typeof createServiceClient>, article: ArticleRow) {
  let factSheet: string | null = null
  let sourceName: string | null = null

  if (article.draft_id) {
    const { data: draft } = await svc
      .from('drafts')
      .select('extracted_facts, source_feed_id')
      .eq('id', article.draft_id)
      .maybeSingle()
    factSheet = draft?.extracted_facts ?? null

    if (draft?.source_feed_id) {
      const { data: src } = await svc
        .from('rss_sources')
        .select('name')
        .eq('id', draft.source_feed_id)
        .maybeSingle()
      sourceName = src?.name ?? null
    }
  }

  // Prefer the original source over the rewritten article body — it is the same
  // material ingest would have distilled from.
  let content = article.content
  if (!factSheet && article.source_url) {
    const fetched = await fetchArticleText(article.source_url)
    if (fetched && fetched.length >= 200) content = fetched
  }

  return ensureArticleFact(svc, {
    articleId: article.id,
    title: article.title,
    content,
    sourceUrl: article.source_url,
    sourceName,
    draftId: article.draft_id,
    factSheet,
    // Backdate to publication so a backfill slots into Fact Flow chronologically
    // instead of dropping months of old news at the top of the stream.
    createdAt: article.published_at,
  })
}

// POST /api/admin/backfill-facts
// Body: { article_id?, slug? }        — one article
//       { all: true, limit?: number } — the next batch of articles with no fact
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const { article_id, slug, all } = body
  const svc = createServiceClient()

  if (all) {
    const limit = Math.min(Math.max(Number(body.limit) || BATCH_LIMIT, 1), 25)

    // Articles that already have a fact, so they can be excluded below.
    const { data: linked, error: linkedError } = await svc
      .from('facts')
      .select('article_id')
      .not('article_id', 'is', null)
    if (linkedError) return NextResponse.json({ error: linkedError.message }, { status: 500 })
    const done = new Set((linked ?? []).map(f => f.article_id as string))

    const { data: candidates, error: candidatesError } = await svc
      .from('articles')
      .select(ARTICLE_COLUMNS)
      .not('article_type', 'in', `(${EXCLUDED_TYPES.join(',')})`)
      .order('published_at', { ascending: false })
    if (candidatesError) return NextResponse.json({ error: candidatesError.message }, { status: 500 })

    const pending = (candidates as ArticleRow[] ?? []).filter(a => !done.has(a.id))
    const batch = pending.slice(0, limit)

    const results: { slug: string; status: string; content?: string; reason?: string }[] = []
    for (const article of batch) {
      const result = await backfillOne(svc, article)
      results.push({
        slug: article.slug,
        status: result.status,
        content: 'content' in result ? result.content : undefined,
        reason: 'reason' in result ? result.reason : undefined,
      })
    }

    const created = results.filter(r => r.status === 'created' || r.status === 'promoted').length

    return NextResponse.json({
      created,
      skipped: results.length - created,
      processed: results.length,
      remaining: Math.max(pending.length - batch.length, 0),
      results,
    })
  }

  if (!article_id && !slug) {
    return NextResponse.json({ error: 'Provide article_id, slug, or all: true' }, { status: 400 })
  }

  let query = svc.from('articles').select(ARTICLE_COLUMNS)
  query = article_id ? query.eq('id', article_id) : query.eq('slug', slug)

  const { data: article, error: articleError } = await query.single()
  if (articleError || !article) return NextResponse.json({ error: 'Article not found' }, { status: 404 })

  const result = await backfillOne(svc, article as ArticleRow)

  if (result.status === 'exists') {
    return NextResponse.json({
      message: `Already on Fact Flow — skipping. Delete the existing fact first to re-run.`,
      count: result.count,
    })
  }
  if (result.status === 'skipped') {
    return NextResponse.json({ error: result.reason }, { status: 422 })
  }

  return NextResponse.json({
    ok: true,
    article_slug: (article as ArticleRow).slug,
    facts_saved: 1,
    fact: result.content,
    status: result.status,
  })
}
