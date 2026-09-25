import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { digestEmail } from '@/lib/email/templates'
import { digestFrom, getResend, SITE_URL } from '@/lib/email/send'
import { currentPeriod } from '@/lib/email/period'
import { buildIssue } from '@/lib/email/issue'

export const maxDuration = 300

const BATCH_SIZE = 100

// Idempotency guard: how recently a subscriber must have already been sent
// something before a new run skips them as "covered." Deliberately much
// shorter than the 7-day period — comparing last_sent_at against periodStart
// (now - 7 days) meant an off-schedule send (an admin test, a retry) at any
// point in the last week could land after the *next* run's periodStart and
// silently suppress that week's real send. A short gap still catches the
// actual re-run scenarios (same-day retry, duplicate dispatch) without
// blocking a legitimately separate week's issue that happens to land a few
// days early or late.
const MIN_RESEND_GAP_MS = 24 * 60 * 60 * 1000

export async function POST(req: NextRequest) {
  const auth = req.headers.get('Authorization')
  const isCron = auth === `Bearer ${process.env.CRON_SECRET}`

  if (!isCron) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user || user.email !== process.env.ADMIN_EMAIL) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  // Dry run resolves recipients exactly as a real send would but stops before
  // Resend, so the admin dashboard can preview a send before committing to it.
  // Nothing is emailed and no send is recorded.
  const dryRun = req.nextUrl.searchParams.get('dry') === '1'
  const { periodStart, periodEnd, periodLabel } = currentPeriod()

  const service = createServiceClient()

  const { issue, error: issueError } = await buildIssue(service, periodStart, periodEnd)

  if (issueError) return NextResponse.json({ error: issueError }, { status: 500 })
  if (!issue) {
    return NextResponse.json({
      ok: true,
      dryRun,
      recipients: 0,
      sent: 0,
      skipped: 0,
      articles: 0,
      reason: 'no articles in period',
    })
  }

  // Every subscriber gets the same issue; only the unsubscribe link differs.
  const subject = issue.topStory ? `The Weekly: ${issue.topStory.title}` : 'The Weekly from LocReport'

  const { data: subscribers, error: subsError } = await service
    .from('subscribers')
    .select('id, email, manage_token, last_sent_at')
    .eq('status', 'active')

  if (subsError) return NextResponse.json({ error: subsError.message }, { status: 500 })

  type Payload = {
    from: string
    to: string
    subject: string
    html: string
    headers: Record<string, string>
    subscriberId: string
    articleIds: string[]
  }
  const payloads: Payload[] = []
  let skipped = 0

  for (const sub of subscribers ?? []) {
    // Idempotency: safe to re-run — anyone sent something too recently is skipped
    if (sub.last_sent_at && periodEnd.getTime() - new Date(sub.last_sent_at).getTime() < MIN_RESEND_GAP_MS) {
      skipped++
      continue
    }

    // The footer links to the manage page (unsubscribe lives there, behind a
    // confirmation); the header keeps the one-click API target mail clients need.
    const manageUrl = `${SITE_URL}/subscribe/manage?token=${sub.manage_token}`
    const unsubscribeUrl = `${SITE_URL}/api/subscribe/unsubscribe?token=${sub.manage_token}`

    payloads.push({
      from: digestFrom(),
      to: sub.email,
      subject,
      html: digestEmail({ periodLabel, ...issue, manageUrl }),
      headers: {
        'List-Unsubscribe': `<${unsubscribeUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
      subscriberId: sub.id,
      articleIds: issue.articleIds,
    })
  }

  if (dryRun) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      recipients: payloads.length,
      sent: 0,
      skipped,
      articles: issue.stats.stories,
      errors: [],
    })
  }

  const resend = getResend()
  let sent = 0
  const errors: string[] = []

  for (let i = 0; i < payloads.length; i += BATCH_SIZE) {
    const batch = payloads.slice(i, i + BATCH_SIZE)
    const { data, error } = await resend.batch.send(
      batch.map(({ from, to, subject, html, headers }) => ({ from, to, subject, html, headers }))
    )
    if (error) {
      errors.push(error.message)
      continue
    }
    const now = new Date().toISOString()
    for (let j = 0; j < batch.length; j++) {
      const p = batch[j]
      sent++
      // subject/html are snapshotted here so a past issue can be viewed later
      // exactly as sent, rather than recomposed against data that has since
      // moved on (quotes, facts, edited articles).
      await service.from('digest_sends').insert({
        subscriber_id: p.subscriberId,
        period_start: periodStart.toISOString(),
        period_end: periodEnd.toISOString(),
        article_ids: p.articleIds,
        resend_id: data?.data?.[j]?.id ?? null,
        subject: p.subject,
        html: p.html,
      })
      await service.from('subscribers').update({ last_sent_at: now }).eq('id', p.subscriberId)
    }
  }

  return NextResponse.json({
    ok: true,
    dryRun: false,
    recipients: payloads.length,
    sent,
    skipped,
    articles: issue.stats.stories,
    errors,
  })
}
