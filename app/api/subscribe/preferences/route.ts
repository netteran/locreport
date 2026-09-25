import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

// Token-authenticated subscription changes from the manage page. The Weekly
// has no per-subscriber preferences any more — everyone gets the same issue —
// so the only choices are to unsubscribe or to re-subscribe.
export async function POST(req: NextRequest) {
  let body: { token?: string; unsubscribe?: boolean; resubscribe?: boolean }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const token = body.token ?? ''
  if (!/^[0-9a-f-]{36}$/i.test(token)) {
    return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
  }

  const supabase = createServiceClient()
  const { data: subscriber } = await supabase
    .from('subscribers')
    .select('id, status')
    .eq('manage_token', token)
    .maybeSingle()

  if (!subscriber) return NextResponse.json({ error: 'Invalid token' }, { status: 401 })

  if (body.unsubscribe) {
    const { error } = await supabase
      .from('subscribers')
      .update({ status: 'unsubscribed', unsubscribed_at: new Date().toISOString() })
      .eq('id', subscriber.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, status: 'unsubscribed' })
  }

  // Re-subscribing from the manage link is allowed without a second opt-in:
  // the token proves the address already confirmed once. A never-confirmed
  // (pending) address has to finish the confirm email instead.
  if (body.resubscribe) {
    if (subscriber.status === 'pending') {
      return NextResponse.json({ error: 'Please confirm your subscription from the email we sent you.' }, { status: 400 })
    }
    const { error } = await supabase
      .from('subscribers')
      .update({ status: 'active', unsubscribed_at: null })
      .eq('id', subscriber.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, status: 'active' })
  }

  return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
}
