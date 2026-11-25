import type { SupabaseClient } from '@supabase/supabase-js'

// Search-engine exclusion for pruned articles (`articles.noindex`, migration
// 20261202_article_noindex.sql). Both readers degrade to "index everything" when
// the column is missing or the query fails, so neither the sitemap nor an article
// page can break on it; a failure only means a pruned page stays indexable a
// little longer.

// PostgREST caps a response at 1,000 rows, and a heavy prune can exceed that.
const PAGE = 1000

export async function noindexArticleIds(client: SupabaseClient): Promise<Set<string>> {
  const ids = new Set<string>()
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client.from('articles').select('id, noindex')
      .eq('noindex', true).order('id').range(from, from + PAGE - 1)
    if (error) {
      console.warn('[noindex] lookup failed; listing every article:', error.message)
      return new Set()
    }
    // Re-check the flag on each row: a filter that is silently ignored must never
    // empty the sitemap.
    for (const row of data ?? []) if (row.noindex === true) ids.add(row.id as string)
    if (!data || data.length < PAGE) return ids
  }
}

export async function isArticleNoindex(client: SupabaseClient, id: string): Promise<boolean> {
  const { data, error } = await client.from('articles').select('noindex').eq('id', id).maybeSingle()
  if (error) return false
  return data?.noindex === true
}
