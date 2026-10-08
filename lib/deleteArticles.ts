import type { SupabaseClient } from '@supabase/supabase-js'
import { revalidateArticleSurfaces } from '@/lib/revalidate'

const CHUNK = 100

/**
 * Deletes articles together with their Fact Flow facts — the one place that
 * logic lives, used by the single-article DELETE route and the bulk delete on
 * /admin/articles.
 *
 * `facts.article_id` was created `ON DELETE SET NULL`, so deleting an article
 * used to leave its fact behind as an orphan row (hidden from /fact-flow, but
 * still in the table and still pointing at the draft). The fact belongs to the
 * article, so it goes with it. Migration 20261008_facts_article_cascade.sql
 * makes the FK cascade too, so a delete from the Supabase dashboard is covered.
 */
export async function deleteArticles(
  supabase: SupabaseClient,
  ids: string[],
): Promise<{ deleted: number; factsDeleted: number }> {
  if (ids.length === 0) return { deleted: 0, factsDeleted: 0 }
  // `.in()` goes into the PostgREST URL; keep each request well under its length limit.
  if (ids.length > CHUNK) {
    let deleted = 0
    let factsDeleted = 0
    for (let i = 0; i < ids.length; i += CHUNK) {
      const r = await deleteArticles(supabase, ids.slice(i, i + CHUNK))
      deleted += r.deleted
      factsDeleted += r.factsDeleted
    }
    return { deleted, factsDeleted }
  }

  // Read slugs first so each deleted article's cached detail page can be
  // dropped too, rather than serving a ghost for another 24h.
  const { data: existing } = await supabase
    .from('articles')
    .select('id, slug, article_type')
    .in('id', ids)

  const { data: facts, error: factsError } = await supabase
    .from('facts')
    .delete()
    .in('article_id', ids)
    .select('id')
  if (factsError) throw new Error(`Could not delete facts: ${factsError.message}`)

  const { error } = await supabase.from('articles').delete().in('id', ids)
  if (error) throw new Error(error.message)

  const rows = existing ?? []
  revalidateArticleSurfaces({ monthlyReport: rows.some((r) => r.article_type === 'monthly-summary') })
  for (const row of rows) revalidateArticleSurfaces({ slug: row.slug })

  return { deleted: rows.length, factsDeleted: facts?.length ?? 0 }
}
