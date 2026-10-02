import { cache } from 'react'
import { createServiceClient } from '@/lib/supabase/server'
import { safeImageUrl } from '@/lib/utils'
import { reportImageKey, type ReportImage } from '@/lib/reports'

/**
 * Lead image for an annual report (see lib/reports.ts), or null. Decorative,
 * so any failure — missing row, bad JSON, Supabase down — degrades to the
 * image-less page rather than throwing.
 */
export const getReportImage = cache(async (slug: string): Promise<ReportImage | null> => {
  try {
    const { data } = await createServiceClient()
      .from('settings').select('value').eq('key', reportImageKey(slug)).maybeSingle()
    if (!data?.value) return null
    const parsed = JSON.parse(data.value) as Partial<ReportImage>
    const url = safeImageUrl(parsed.url ?? null)
    return url ? { url, alt: (parsed.alt ?? '').trim() } : null
  } catch {
    return null
  }
})
