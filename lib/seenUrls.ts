import type { SupabaseClient } from '@supabase/supabase-js'

/** Read every page: PostgREST caps each response, even without a limit. */
export async function loadSeenUrls(supabase: SupabaseClient): Promise<Set<string>> {
  const seen = new Set<string>()
  for (const table of ['seen_urls', 'drafts', 'articles'] as const) {
    const key = table === 'seen_urls' ? 'url' : 'id'
    const urlColumn = table === 'seen_urls' ? 'url' : 'source_url'
    let cursor: string | undefined
    while (true) {
      let query = supabase.from(table).select(key === urlColumn ? key : `${key},${urlColumn}`)
        .not(urlColumn, 'is', null).order(key).limit(500)
      if (cursor !== undefined) query = query.gt(key, cursor)
      const { data, error } = await query
      if (error) throw new Error(`Could not read ${table} for deduplication: ${error.message}`)
      const rows = data as unknown as Record<string, string>[] | null
      if (!rows?.length) break
      for (const row of rows) seen.add(row[urlColumn])
      // Advance by the returned key, not the requested page size: a server
      // configured with a smaller row cap must not silently drop history.
      cursor = rows[rows.length - 1][key]
    }
  }
  return seen
}

export async function rememberSeenUrl(supabase: SupabaseClient, url: string): Promise<void> {
  const { error } = await supabase.from('seen_urls')
    .upsert({ url }, { onConflict: 'url', ignoreDuplicates: true })
  if (error) throw new Error(`Could not remember seen URL: ${error.message}`)
}
