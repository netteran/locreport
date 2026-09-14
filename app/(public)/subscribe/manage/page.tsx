import Link from 'next/link'
import type { Metadata } from 'next'
import { createServiceClient } from '@/lib/supabase/server'
import ManageForm from './ManageForm'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Manage digest preferences',
  robots: { index: false, follow: false },
}

export default async function ManagePage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams

  let subscriber: {
    email: string
    status: string
    signal_prefs: string[]
    include_summary: boolean
    min_impact: number
  } | null = null

  if (token && /^[0-9a-f-]{36}$/i.test(token)) {
    const supabase = createServiceClient()
    const { data } = await supabase
      .from('subscribers')
      .select('email, status, signal_prefs, include_summary, min_impact')
      .eq('manage_token', token)
      .maybeSingle()
    subscriber = data
  }

  if (!subscriber || !token) {
    return (
      <div className="container subscribe-status-page">
        <h1>Link not valid</h1>
        <p className="subscribe-status__text">
          This preferences link is invalid. Use the “Manage preferences” link
          from any digest email, or subscribe again from the homepage.
        </p>
        <Link href="/" className="btn btn--primary">Back to LocReport</Link>
      </div>
    )
  }

  return (
    <div className="container subscribe-manage-page">
      <h1>Digest preferences</h1>
      <p className="subscribe-status__text">
        Subscribed as <strong>{subscriber.email}</strong>
        {subscriber.status === 'unsubscribed' && ' (currently unsubscribed — saving preferences re-activates your subscription)'}
      </p>
      <ManageForm
        token={token}
        initial={{
          signal_prefs: subscriber.signal_prefs,
          include_summary: subscriber.include_summary ?? true,
          min_impact: subscriber.min_impact,
        }}
      />
    </div>
  )
}
