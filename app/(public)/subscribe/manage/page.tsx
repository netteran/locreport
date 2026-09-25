import Link from 'next/link'
import type { Metadata } from 'next'
import { createServiceClient } from '@/lib/supabase/server'
import ManageForm from './ManageForm'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Your subscription',
  robots: { index: false, follow: false },
}

// Reached from the "Manage preferences" link in issues sent before The Weekly
// became one issue for everyone. There is nothing left to configure, so it
// only shows the subscription and offers to end or restore it.
export default async function ManagePage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams

  let subscriber: { email: string; status: string } | null = null

  if (token && /^[0-9a-f-]{36}$/i.test(token)) {
    const supabase = createServiceClient()
    const { data } = await supabase
      .from('subscribers')
      .select('email, status')
      .eq('manage_token', token)
      .maybeSingle()
    subscriber = data
  }

  if (!subscriber || !token) {
    return (
      <div className="container subscribe-status-page">
        <h1>Link not valid</h1>
        <p className="subscribe-status__text">
          This link is invalid. Use the “Unsubscribe” link from any issue of
          The Weekly, or sign up again from the homepage.
        </p>
        <Link href="/" className="btn btn--primary">Back to LocReport</Link>
      </div>
    )
  }

  return (
    <div className="container subscribe-manage-page">
      <h1>Your subscription to The Weekly</h1>
      <p className="subscribe-status__text">
        Subscribed as <strong>{subscriber.email}</strong>
      </p>
      <ManageForm token={token} initialStatus={subscriber.status} />

      <section className="weekly-feedback" aria-labelledby="weekly-feedback-title">
        <p className="weekly-feedback__eyebrow">Help shape The Weekly</p>
        <h2 className="weekly-feedback__title" id="weekly-feedback-title">
          Got an idea for what we should change or cover?
        </h2>
        <p className="weekly-feedback__text">
          A topic you’d like tracked, a company we’re missing, a section you’d
          drop or one you’d add — we read every suggestion, and the next issue
          may well be shaped by yours.
        </p>
        <Link href={`/contact?subject=${encodeURIComponent('Suggestion for The Weekly')}`} className="btn btn--primary">
          Share a suggestion →
        </Link>
      </section>
    </div>
  )
}
