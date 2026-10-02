import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { safeImageUrl } from '@/lib/utils'
import { ANNUAL_REPORTS, annualReportPath, reportImageKey } from '@/lib/reports'

// Sets or clears an annual report's lead image (stored in `settings`; see
// lib/reports.ts). Monthly reports are articles and use /api/articles/[id].
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.email !== process.env.ADMIN_EMAIL) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const slug = typeof body.slug === 'string' ? body.slug : ''
  if (!ANNUAL_REPORTS.some(r => r.slug === slug)) {
    return NextResponse.json({ error: 'Unknown report' }, { status: 400 })
  }

  const rawUrl = typeof body.image_url === 'string' ? body.image_url.trim() : ''
  const url = rawUrl ? safeImageUrl(rawUrl) : null
  if (rawUrl && !url) {
    return NextResponse.json({ error: 'Image URL must be http(s) or root-relative' }, { status: 400 })
  }
  const alt = typeof body.image_alt === 'string' ? body.image_alt.trim() : ''

  const service = createServiceClient()
  const key = reportImageKey(slug)
  const { error } = url
    ? await service.from('settings').upsert({ key, value: JSON.stringify({ url, alt }) }, { onConflict: 'key' })
    : await service.from('settings').delete().eq('key', key)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  for (const path of [annualReportPath(slug), '/reports']) {
    try {
      revalidatePath(path)
    } catch (err) {
      console.error(`[reports] could not revalidate ${path}:`, err)
    }
  }
  return NextResponse.json({ ok: true })
}
