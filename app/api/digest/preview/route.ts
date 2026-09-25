import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { digestEmail } from '@/lib/email/templates'
import { SITE_URL } from '@/lib/email/send'
import { currentPeriod } from '@/lib/email/period'
import { buildIssue } from '@/lib/email/issue'

// Renders the current period's issue exactly as subscribers will get it —
// every subscriber receives the same issue — so the admin can check layout
// and wording before sending. Admin session only; never touches Resend or
// writes to the DB.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.email !== process.env.ADMIN_EMAIL) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { periodStart, periodEnd, periodLabel } = currentPeriod()
  const service = createServiceClient()
  const { issue, error } = await buildIssue(service, periodStart, periodEnd)
  if (error) return NextResponse.json({ error }, { status: 500 })
  if (!issue) {
    return new NextResponse('<p style="font-family:sans-serif">No articles published in the last 7 days — nothing would be sent.</p>', {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  }

  const html = digestEmail({
    periodLabel,
    ...issue,
    manageUrl: `${SITE_URL}/subscribe/manage?token=preview`,
  })

  return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}
