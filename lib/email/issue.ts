// Fetches everything one issue of The Weekly needs and hands it to
// composeIssue(). Shared by /api/digest/send and /api/digest/preview, so the
// sample the admin views is exactly the issue subscribers get. Every
// subscriber receives the same issue; only the tokenized links differ.
import { createServiceClient } from '@/lib/supabase/server'
import { DIRECTORY } from '@/lib/data/directory'
import { fetchDirectoryEntries } from '@/lib/directory'
import { composeIssue, pickCompanyOfWeek, summarizeMarket, SIGNAL_BASELINE_WEEKS, DigestSourceArticle, Issue } from '@/lib/email/digest'
import { fetchPeriodArticles } from '@/lib/email/period'

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

type Service = ReturnType<typeof createServiceClient>

export async function buildIssue(
  service: Service,
  periodStart: Date,
  periodEnd: Date
): Promise<{ issue: Issue | null; error?: string }> {
  const { data: articles, error } = await fetchPeriodArticles(service, periodStart)
  if (error) return { issue: null, error: error.message }
  if (!articles || articles.length === 0) return { issue: null }

  const baselineStart = new Date(periodStart.getTime() - SIGNAL_BASELINE_WEEKS * WEEK_MS)
  const ids = articles.map(a => a.id)

  // Everything below is supporting material: a failure drops that block from
  // the issue rather than holding the send.
  const [prior, facts, quotes, directory, allCompanies] = await Promise.all([
    service
      .from('articles')
      .select('signal_ids')
      .eq('article_type', 'industry')
      .gte('published_at', baselineStart.toISOString())
      .lt('published_at', periodStart.toISOString()),
    service.from('facts').select('content, article_id').in('article_id', ids),
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

  const issue = composeIssue({
    articles: articles as DigestSourceArticle[],
    priorArticles: prior.data ?? [],
    facts: (facts.data ?? []).filter((f): f is { content: string; article_id: string } => !!f.article_id && !!f.content),
    market: quotes.data ? summarizeMarket(quotes.data, periodStart, periodEnd) : null,
    company: pickCompanyOfWeek(allCompanies, periodEnd),
    directory: newCompanies,
  })
  return { issue }
}
