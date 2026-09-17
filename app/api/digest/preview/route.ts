import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { digestEmail } from '@/lib/email/templates'
import { SITE_URL } from '@/lib/email/send'
import { composeDigest, selectForSubscriber, DigestPrefs, DigestSourceArticle } from '@/lib/email/digest'
import { currentPeriod, fetchPeriodArticles } from '@/lib/email/period'
import { SIGNALS } from '@/lib/signals'

// Renders the fullest possible version of the current period's issue — every
// signal section populated, the full roundup — so the admin can check layout
// and wording before sending. Any one subscriber's actual email is a
// filtered subset of this, personalised by their own preferences. Admin
// session only; never touches Resend or writes to the DB.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.email !== process.env.ADMIN_EMAIL) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { periodStart, periodLabel } = currentPeriod()
  const service = createServiceClient()
  const { data: articles, error } = await fetchPeriodArticles(service, periodStart)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const prefs: DigestPrefs = {
    signalPrefs: SIGNALS.map(s => s.id),
    includeSummary: true,
    minImpact: 1,
  }
  const matched = selectForSubscriber((articles ?? []) as DigestSourceArticle[], prefs)
  const { topStory, sections, roundup, roundupHeading } = composeDigest(matched, prefs)
  const html = digestEmail({
    periodLabel,
    topStory,
    sections,
    roundup,
    roundupHeading,
    manageUrl: `${SITE_URL}/subscribe/manage?token=preview`,
    unsubscribeUrl: `${SITE_URL}/api/subscribe/unsubscribe?token=preview`,
  })

  return new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}
