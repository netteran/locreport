import type { SupabaseClient } from '@supabase/supabase-js'

export const WEEKLY_NOTE_LIMIT = 2000
export const WEEKLY_NOTE_MIGRATION = '20261116_weekly_newsletter_notes.sql'

// Monday–Friday previews and sends share Friday's edition. Saturday starts the
// next edition. Use the publishing timezone, including DST, rather than UTC.
export function weeklyEditionDate(now = new Date()): string {
  const localDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(now)
  const date = new Date(`${localDate}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + (5 - date.getUTCDay() + 7) % 7)
  return date.toISOString().slice(0, 10)
}

export function normalizeWeeklyNote(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Paragraph must be text')
  if (value.length > WEEKLY_NOTE_LIMIT) throw new Error(`Keep the paragraph within ${WEEKLY_NOTE_LIMIT} characters`)
  return value.replace(/\r\n?/g, '\n').trim()
}

export function missingWeeklyNotes(error: { code?: string; message?: string } | null): boolean {
  return !!error && ['42P01', 'PGRST205'].includes(error.code || '') &&
    /\bweekly_newsletter_notes\b/.test(error.message || '')
}

export async function loadWeeklyNote(service: SupabaseClient, now = new Date(), allowMissing = false) {
  const editionDate = weeklyEditionDate(now)
  const { data, error } = await service.from('weekly_newsletter_notes')
    .select('paragraph').eq('edition_date', editionDate).maybeSingle()
  if (error) {
    // During rollout, an older schema can still send the original newsletter.
    // Other failures must stop sending rather than silently omit saved copy.
    if (allowMissing && missingWeeklyNotes(error)) return { editionDate, paragraph: '' }
    throw new Error(missingWeeklyNotes(error)
      ? `Apply Supabase migration ${WEEKLY_NOTE_MIGRATION} to edit the newsletter paragraph.`
      : `Could not load the newsletter paragraph: ${error.message}`)
  }
  return { editionDate, paragraph: data?.paragraph || '' }
}
