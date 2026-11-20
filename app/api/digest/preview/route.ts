import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { digestEmail, editedDigestEmail } from '@/lib/email/templates'
import { SITE_URL } from '@/lib/email/send'
import { currentPeriod } from '@/lib/email/period'
import { resolveEdition } from '@/lib/email/edition'
import type { Issue } from '@/lib/email/digest'

// Preview both the subscriber email and its recipient-free browser version.
// Both modes are admin-only and render without sending or publishing the issue.
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.email !== process.env.ADMIN_EMAIL) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { periodStart, periodEnd, periodLabel } = currentPeriod()
  const service = createServiceClient()
  let edition
  try { edition = await resolveEdition(service, periodStart, periodEnd) }
  catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 503 }) }
  if (req.nextUrl.searchParams.has('revision') && req.nextUrl.searchParams.get('revision') !== edition.revision)
    return NextResponse.json({ error: 'The edition changed. Reload before previewing.' }, { status: 409 })
  const issue = edition.issue
  if (!issue) {
    return new NextResponse('<p style="font-family:sans-serif">No articles published in the last 7 days — nothing would be sent.</p>', {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  }

  const browserPreview = req.nextUrl.searchParams.get('browser') === '1'
  const query = new URLSearchParams({ browser: '1' })
  if (edition.revision) query.set('revision', edition.revision)
  const links = browserPreview ? {} : {
    manageUrl: `${SITE_URL}/subscribe/manage?token=preview`,
    browserUrl: `/api/digest/preview?${query}`,
  }

  const html = edition.bodyMarkdown !== null ? editedDigestEmail({ editionDate: edition.editionDate, bodyMarkdown: edition.bodyMarkdown,
    ...links,
  }) : digestEmail({
    periodLabel,
    ...(issue as Issue),
    ...links,
  })

  return new NextResponse(html, { headers: {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'private, no-store',
  } })
}
