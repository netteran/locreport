import type { SupabaseClient } from '@supabase/supabase-js'
import { revalidateArticleSurfaces } from '@/lib/revalidate'

const CHUNK = 100

/** Remove articles and their analysis links; independently published news facts survive. */
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

  const { error } = await supabase.from('articles').delete().in('id', ids)
  if (error) throw new Error(error.message)

  const rows = existing ?? []
  revalidateArticleSurfaces({ monthlyReport: rows.some((r) => r.article_type === 'monthly-summary') })
  for (const row of rows) revalidateArticleSurfaces({ slug: row.slug })

  return { deleted: rows.length, factsDeleted: 0 }
}
