import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Unsubscribed',
  robots: { index: false, follow: false },
}

export default function UnsubscribedPage() {
  return (
    <div className="container subscribe-status-page">
      <h1>You’ve been unsubscribed</h1>
      <p className="subscribe-status__text">
        You won’t receive The Weekly any more. If this was a mistake,
        you can sign up again anytime from the homepage.
      </p>
      <Link href="/" className="btn btn--primary">Back to LocReport</Link>
    </div>
  )
}
