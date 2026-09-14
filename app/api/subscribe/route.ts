import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { SIGNAL_MAP } from '@/lib/signals'
import { confirmEmail } from '@/lib/email/templates'
import { digestFrom, getResend, SITE_URL } from '@/lib/email/send'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Double-opt-in step 1: store a pending subscriber and send the confirm link.
// The response is intentionally generic so the endpoint can't be used to
// probe which addresses are subscribed.
export async function POST(req: NextRequest) {
  let body: { email?: string; signal_prefs?: string[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const email = body.email?.trim().toLowerCase() ?? ''
  if (!EMAIL_RE.test(email) || email.length > 254) {
    return NextResponse.json({ error: 'Please enter a valid email address' }, { status: 400 })
  }

  const signal_prefs = Array.isArray(body.signal_prefs)
    ? body.signal_prefs.filter(id => SIGNAL_MAP.has(id))
    : []

  const supabase = createServiceClient()
  const genericOk = NextResponse.json({ ok: true, message: 'Check your inbox to confirm your subscription.' })

  const { data: existing } = await supabase
    .from('subscribers')
    .select('id, status, confirm_token, created_at')
    .eq('email', email)
    .maybeSingle()

  if (existing?.status === 'active') return genericOk

  // Naive rate limit: don't re-send a confirm email more than every 2 minutes.
  if (
    existing?.status === 'pending' &&
    Date.now() - new Date(existing.created_at).getTime() < 2 * 60 * 1000
  ) {
    return genericOk
  }

  const { data: subscriber, error } = await supabase
    .from('subscribers')
    .upsert(
      {
        email,
        status: 'pending',
        signal_prefs,
        created_at: new Date().toISOString(),
        unsubscribed_at: null,
      },
      { onConflict: 'email' }
    )
    .select('confirm_token')
    .single()

  if (error || !subscriber) {
    console.error('subscribe upsert failed', error)
    return NextResponse.json({ error: 'Something went wrong — please try again' }, { status: 500 })
  }

  const confirmUrl = `${SITE_URL}/subscribe/confirm?token=${subscriber.confirm_token}`
  const { error: emailError } = await getResend().emails.send({
    from: digestFrom(),
    to: email,
    subject: 'Confirm your spot on The Weekly',
    html: confirmEmail({ confirmUrl }),
  })
  if (emailError) {
    console.error('confirm email send failed', emailError)
    return NextResponse.json({ error: 'Could not send the confirmation email — please try again' }, { status: 500 })
  }

  return genericOk
}
