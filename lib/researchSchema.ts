import type { SupabaseClient } from '@supabase/supabase-js'

export const RESEARCH_MIGRATION = '20261113_research_publications.sql'
export const SINGLE_SOURCE_MIGRATION = '20261114_single_source_articles.sql'

type DatabaseError = { code?: string; message?: string } | null

/** Older installations can keep composing multi-source articles during rollout. */
export function singleSourceMigrationProblem(error: DatabaseError, sourceCount: number) {
  if (sourceCount !== 1 || !/^Select 2[–-]8 source candidates$/i.test(error?.message || '')) return null
  return `Apply Supabase migration ${SINGLE_SOURCE_MIGRATION} to create articles from a single source.`
}

/** Only absent new publication columns justify the read-only legacy fallback. */
export function missingPublicationColumns(error: DatabaseError): boolean {
  if (!error) return false
  const message = error.message || ''
  if (error.code === '42703') {
    return /\bfacts\.(?:event_id|status|published_at)\b/i.test(message)
  }
  return (
    error.code === 'PGRST204' &&
    /\bfacts\b/i.test(message) &&
    /['"](?:event_id|status|published_at)['"]/i.test(message)
  )
}

export async function researchSchemaProblem(client: SupabaseClient): Promise<string | null> {
  const { error } = await client.from('facts').select('event_id,status,published_at').limit(0)
  if (!error) return null
  if (missingPublicationColumns(error)) {
    return `Apply Supabase migration ${RESEARCH_MIGRATION} before using the research and publishing workflow. Existing public news remains readable.`
  }
  return `Cannot verify the research schema: ${error.message}`
}
