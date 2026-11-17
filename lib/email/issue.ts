// Fetches everything one issue of The Weekly needs and hands it to
// composeIssue(). Shared by /api/digest/send and /api/digest/preview, so the
// sample the admin views is exactly the issue subscribers get. Every
// subscriber receives the same issue; only the tokenized links differ.
import { createServiceClient } from '@/lib/supabase/server'
import { DIRECTORY } from '@/lib/data/directory'
import { fetchDirectoryEntries } from '@/lib/directory'
import { composeIssue, pickCompanyOfWeek, summarizeMarket, DigestSourceArticle, Issue } from '@/lib/email/digest'
import { loadWeeklyNote } from '@/lib/email/weeklyNote'
import { fetchPeriodArticles } from '@/lib/email/period'

type Service = ReturnType<typeof createServiceClient>

export async function buildIssue(
  service: Service,
  periodStart: Date,
  periodEnd: Date
): Promise<{ issue: Issue | null; error?: string }> {
  let editorNote: string
  try {
    editorNote = (await loadWeeklyNote(service, periodEnd, true)).paragraph
  } catch (error) {
    return { issue: null, error: error instanceof Error ? error.message : 'Could not load newsletter paragraph' }
  }
  const { data: articles, error } = await fetchPeriodArticles(service, periodStart)
  if (error) return { issue: null, error: error.message }

  // Everything below is supporting material: a failure drops that block from
  // the issue rather than holding the send.
  const [facts, quotes, directory, allCompanies] = await Promise.all([
    service.from('facts').select('id,content,article_id,published_at').eq('status','published').gte('published_at',periodStart.toISOString()).lt('published_at',periodEnd.toISOString()).order('published_at',{ascending:false}).limit(20),
    service.from('market_quotes').select('ticker, data'),
    service
      .from('directory')
      .select('name, slug, category, description, created_at')
      .gte('created_at', periodStart.toISOString())
      .order('created_at', { ascending: true }),
    // Curated array merged with the table, exactly as /compass/directory shows it.
    fetchDirectoryEntries(service),
  ])

  // A table row sharing a slug with the curated array is an edit of an
  // existing company, not a new one.
  const staticSlugs = new Set(DIRECTORY.map(d => d.slug))
  const newCompanies = (directory.data ?? []).filter(d => d.slug && !staticSlugs.has(d.slug))
  if (!articles?.length && !facts.data?.length) return { issue: null }

  const issue = composeIssue({
    articles: (articles ?? []) as DigestSourceArticle[],
    facts: facts.data ?? [],
    market: quotes.data ? summarizeMarket(quotes.data, periodStart, periodEnd) : null,
    company: pickCompanyOfWeek(allCompanies, periodEnd),
    directory: newCompanies,
  })
  return { issue: { ...issue, editorNote } }
}
