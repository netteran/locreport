import type { SupabaseClient } from '@supabase/supabase-js'
import { isContentType, type PostReference } from './contentTaxonomy'

/** Search RPCs return legacy projections. Resolve their route fields in one query. */
export async function withArticleReferences<Row extends { id: string; slug: string } & Partial<PostReference>>(
  client: SupabaseClient,
  rows: Row[],
): Promise<Row[]> {
  const missing = rows.filter(row => !isContentType(row.content_type))
  if (!missing.length) return rows
  const { data, error } = await client.from('articles')
    .select('id,article_type,content_type,content_slug')
    .in('id', [...new Set(missing.map(row => row.id))])
  if (error) throw new Error(`Could not resolve public article paths: ${error.message}`)
  const references = new Map((data ?? []).map(row => [row.id, row]))
  return rows.map(row => ({ ...row, ...references.get(row.id) }))
}
