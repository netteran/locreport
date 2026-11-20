import { createHash } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { digestEmail, editedDigestEmail } from '@/lib/email/templates'
import { digestFrom, getResend, SITE_URL } from '@/lib/email/send'
import { currentPeriod } from '@/lib/email/period'
import { resolveEdition } from '@/lib/email/edition'
import type { Issue } from '@/lib/email/digest'

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
  const isCron = !!process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`

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
  // ?to=<subscriber id> sends to that one active subscriber only (admin
  // session only — the scheduled run always sends to everyone). A targeted
  // send ignores the resend guard and doesn't touch last_sent_at, so sending
  // someone a copy never makes the scheduled run skip them.
  const to = req.nextUrl.searchParams.get('to')
  if (to && (isCron || !/^[0-9a-f-]{36}$/i.test(to))) {
    return NextResponse.json({ error: 'Invalid recipient' }, { status: 400 })
  }
  const { periodStart, periodEnd, periodLabel } = currentPeriod()

  const service = createServiceClient()

  let edition
  try { edition = await resolveEdition(service, periodStart, periodEnd) }
  catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 503 }) }
  if (req.nextUrl.searchParams.has('revision') && req.nextUrl.searchParams.get('revision') !== edition.revision)
    return NextResponse.json({ error: 'The saved edition changed. Reload and preview before sending.' }, { status: 409 })
  const issue = edition.issue

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
  const subject = edition.subject

  let subscribersQuery = service
    .from('subscribers')
    .select('id, email, manage_token, last_sent_at')
    .eq('status', 'active')
  if (to) subscribersQuery = subscribersQuery.eq('id', to)
  const { data: subscribers, error: subsError } = await subscribersQuery

  if (subsError) return NextResponse.json({ error: subsError.message }, { status: 500 })
  if (to && (subscribers ?? []).length === 0) {
    return NextResponse.json({ error: 'That subscriber is not active' }, { status: 400 })
  }

  const eligible = (subscribers ?? []).filter(sub =>
    to || !sub.last_sent_at || !(periodEnd.getTime() - new Date(sub.last_sent_at).getTime() < MIN_RESEND_GAP_MS),
  )
  const skipped = (subscribers?.length ?? 0) - eligible.length

  if (dryRun || eligible.length === 0) {
    return NextResponse.json({
      ok: true,
      dryRun,
      revision: edition.revision,
      recipients: eligible.length,
      sent: 0,
      skipped,
      articles: issue.storyCount,
      errors: [],
    })
  }

  const bodyMarkdown = edition.bodyMarkdown
  const render = (links: { manageUrl?: string; browserUrl?: string } = {}) =>
    bodyMarkdown !== null
      ? editedDigestEmail({ editionDate: edition.editionDate, bodyMarkdown, ...links })
      : digestEmail({ periodLabel, ...(issue as Issue), ...links })

  // Write one immutable, recipient-free copy before sending so any recipient's
  // web link works immediately. A changed edition receives its own link.
  const browserHtml = render()
  const archiveId = createHash('sha256').update(JSON.stringify([edition.editionDate, subject, browserHtml])).digest('hex')
  const { error: archiveError } = await service.from('weekly_newsletter_web_editions').upsert({
    id: archiveId, edition_date: edition.editionDate, html: browserHtml,
  }, { onConflict: 'id', ignoreDuplicates: true })
  // Allow the existing newsletter to send during rollout if its optional web
  // archive migration has not been applied yet.
  if (archiveError && !(
    ['42P01', 'PGRST205'].includes(archiveError.code) &&
    archiveError.message.includes('weekly_newsletter_web_editions')
  )) {
    console.error('Could not store weekly newsletter web edition', archiveError)
    return NextResponse.json({ error: 'Could not publish the browser edition. Retry the send.' }, { status: 503 })
  }
  if (archiveError) console.warn('The Weekly sent without a browser link because the web edition table is missing.')
  const browserUrl = archiveError ? undefined : `${SITE_URL}/the-weekly/${archiveId}`

  const payloads = eligible.map(sub => {
    const manageUrl = `${SITE_URL}/subscribe/manage?token=${sub.manage_token}`
    const unsubscribeUrl = `${SITE_URL}/api/subscribe/unsubscribe?token=${sub.manage_token}`
    return {
      from: digestFrom(),
      to: sub.email,
      subject,
      html: render({ manageUrl, browserUrl }),
      headers: {
        'List-Unsubscribe': `<${unsubscribeUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
      subscriberId: sub.id,
      articleIds: issue.articleIds,
    }
  })

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
      if (!to) await service.from('subscribers').update({ last_sent_at: now }).eq('id', p.subscriberId)
    }
  }

  return NextResponse.json({
    ok: true,
    dryRun: false,
    recipients: payloads.length,
    sent,
    skipped,
    articles: issue.storyCount,
    errors,
  })
}
