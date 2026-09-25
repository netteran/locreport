import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { SITE_URL } from '@/lib/email/send'

async function unsubscribe(token: string | null): Promise<boolean> {
  if (!token || !/^[0-9a-f-]{36}$/i.test(token)) return false
  const supabase = createServiceClient()
  const { data: subscriber } = await supabase
    .from('subscribers')
    .select('id')
    .eq('manage_token', token)
    .maybeSingle()
  if (!subscriber) return false
  const { error } = await supabase
    .from('subscribers')
    .update({ status: 'unsubscribed', unsubscribed_at: new Date().toISOString() })
    .eq('id', subscriber.id)
  return !error
}

// The email footer link. Opening it no longer unsubscribes on its own — it
// lands on the subscription page with a confirmation step, so a mistaken
// click (or a mail scanner prefetching links) can't end a subscription.
// Old issues link here too, so this path must keep working.
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token') ?? ''
  const dest = new URL('/subscribe/manage', SITE_URL)
  dest.searchParams.set('token', token)
  dest.searchParams.set('confirm', 'unsubscribe')
  return NextResponse.redirect(dest)
}

// RFC 8058 List-Unsubscribe=One-Click target: the mail client's own
// Unsubscribe button POSTs here. The spec requires this to act immediately,
// with no further page, so it stays one step.
export async function POST(req: NextRequest) {
  const ok = await unsubscribe(req.nextUrl.searchParams.get('token'))
  return ok
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: 'Invalid token' }, { status: 400 })
}
