import Link from 'next/link'
import type { Metadata } from 'next'
import { createServiceClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Confirm subscription',
  robots: { index: false, follow: false },
}

export default async function ConfirmPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams

  let state: 'confirmed' | 'already' | 'invalid' = 'invalid'
  let manageToken: string | null = null

  if (token && /^[0-9a-f-]{36}$/i.test(token)) {
    const supabase = createServiceClient()
    const { data: subscriber } = await supabase
      .from('subscribers')
      .select('id, status, manage_token')
      .eq('confirm_token', token)
      .maybeSingle()

    if (subscriber) {
      manageToken = subscriber.manage_token
      if (subscriber.status === 'active') {
        state = 'already'
      } else {
        const { error } = await supabase
          .from('subscribers')
          .update({ status: 'active', confirmed_at: new Date().toISOString(), unsubscribed_at: null })
          .eq('id', subscriber.id)
        state = error ? 'invalid' : 'confirmed'
      }
    }
  }

  return (
    <div className="container subscribe-status-page">
      {state === 'invalid' ? (
        <>
          <h1>Link not valid</h1>
          <p className="subscribe-status__text">
            This confirmation link is invalid or has already been used.
            You can subscribe again from the homepage.
          </p>
          <Link href="/" className="btn btn--primary">Back to LocReport</Link>
        </>
      ) : (
        <>
          <h1>{state === 'confirmed' ? 'You’re subscribed' : 'Already subscribed'}</h1>
          <p className="subscribe-status__text">
            The Weekly will land in your inbox with what’s moving in
            translation, localization and language AI — and what it means
            for your work.
          </p>
          <div className="subscribe-status__actions">
            {manageToken && (
              <Link href={`/subscribe/manage?token=${manageToken}`} className="btn btn--primary">
                Set your preferences
              </Link>
            )}
            <Link href="/articles" className="btn btn--ghost">Browse articles</Link>
          </div>
        </>
      )}
    </div>
  )
}
