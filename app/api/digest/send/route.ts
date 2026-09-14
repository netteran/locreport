import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { digestEmail } from '@/lib/email/templates'
import { digestFrom, getResend, SITE_URL } from '@/lib/email/send'
import { composeDigest, selectForSubscriber, DigestPrefs, DigestSourceArticle } from '@/lib/email/digest'

export const maxDuration = 300

const BATCH_SIZE = 100

// The digest is weekly-only — there is no daily cadence any more.
const PERIOD_DAYS = 7

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
  const periodEnd = new Date()
  const periodStart = new Date(periodEnd.getTime() - PERIOD_DAYS * 24 * 60 * 60 * 1000)

  const service = createServiceClient()

  const { data: articles, error: articlesError } = await service
    .from('articles')
    .select('id, title, slug, excerpt, impact_score, signal_ids, business_implications, published_at')
    .eq('article_type', 'industry')
    .gte('published_at', periodStart.toISOString())
    .order('published_at', { ascending: false })

  if (articlesError) return NextResponse.json({ error: articlesError.message }, { status: 500 })
  if (!articles || articles.length === 0) {
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

  const { data: subscribers, error: subsError } = await service
    .from('subscribers')
    .select('id, email, signal_prefs, include_summary, min_impact, manage_token, last_sent_at')
    .eq('status', 'active')

  if (subsError) return NextResponse.json({ error: subsError.message }, { status: 500 })

  const periodLabel = `Week of ${periodStart.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}`

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
    // Idempotency: safe to re-run — anyone already covered this period is skipped
    if (sub.last_sent_at && new Date(sub.last_sent_at) > periodStart) {
      skipped++
      continue
    }

    const prefs: DigestPrefs = {
      signalPrefs: sub.signal_prefs ?? [],
      // Rows written before the preference existed default to the roundup.
      includeSummary: sub.include_summary ?? true,
      minImpact: sub.min_impact ?? 1,
    }
    const matched = selectForSubscriber(articles as DigestSourceArticle[], prefs)
    if (matched.length === 0) {
      skipped++
      continue
    }

    const { topStory, sections, roundup, roundupHeading } = composeDigest(matched, prefs)
    const manageUrl = `${SITE_URL}/subscribe/manage?token=${sub.manage_token}`
    const unsubscribeUrl = `${SITE_URL}/api/subscribe/unsubscribe?token=${sub.manage_token}`

    payloads.push({
      from: digestFrom(),
      to: sub.email,
      subject: topStory
        ? `The Weekly: ${topStory.title}`
        : 'The Weekly from LocReport',
      html: digestEmail({ periodLabel, topStory, sections, roundup, roundupHeading, manageUrl, unsubscribeUrl }),
      headers: {
        'List-Unsubscribe': `<${unsubscribeUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
      subscriberId: sub.id,
      articleIds: matched.map(a => a.id),
    })
  }

  if (dryRun) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      recipients: payloads.length,
      sent: 0,
      skipped,
      articles: articles.length,
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
      await service.from('digest_sends').insert({
        subscriber_id: p.subscriberId,
        period_start: periodStart.toISOString(),
        period_end: periodEnd.toISOString(),
        article_ids: p.articleIds,
        resend_id: data?.data?.[j]?.id ?? null,
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
    articles: articles.length,
    errors,
  })
}
