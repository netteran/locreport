'use client'

import { useState } from 'react'

export default function ManageForm({
  token,
  initialStatus,
  confirmUnsubscribe = false,
}: {
  token: string
  initialStatus: string
  /** Arrived from an email's Unsubscribe link: open straight on the confirmation. */
  confirmUnsubscribe?: boolean
}) {
  const [subStatus, setSubStatus] = useState(initialStatus)
  const [confirming, setConfirming] = useState(confirmUnsubscribe && initialStatus === 'active')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function change(action: 'unsubscribe' | 'resubscribe') {
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/subscribe/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, [action]: true }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setSubStatus(data.status)
        setConfirming(false)
      } else {
        setError(data.error ?? 'Something went wrong — please try again.')
      }
    } catch {
      setError('Something went wrong — please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="manage-form">
      {subStatus === 'active' && confirming && (
        <section className="manage-form__confirm" role="alertdialog" aria-labelledby="unsub-confirm-title">
          <h2 className="manage-form__heading" id="unsub-confirm-title">Unsubscribe from The Weekly?</h2>
          <p className="manage-form__hint">
            You’ll stop getting it every Friday. You can re-subscribe from this page at any time.
          </p>
          <div className="manage-form__actions">
            <button className="btn btn--danger" onClick={() => change('unsubscribe')} disabled={busy}>
              {busy ? 'Unsubscribing…' : 'Yes, unsubscribe'}
            </button>
            <button className="btn btn--ghost" onClick={() => setConfirming(false)} disabled={busy}>
              Keep my subscription
            </button>
          </div>
        </section>
      )}

      {subStatus === 'active' && !confirming && (
        <>
          <p className="manage-form__hint manage-form__hint--last">
            You get The Weekly every Friday: the top story, how every signal we
            track moved, the week’s key facts, market and directory news when
            there is any, and everything else we published.
          </p>
          <div className="manage-form__actions">
            <button className="btn btn--ghost manage-form__unsub" onClick={() => setConfirming(true)}>
              Unsubscribe
            </button>
          </div>
        </>
      )}

      {subStatus === 'unsubscribed' && (
        <>
          <p className="manage-form__hint manage-form__hint--last">
            You’re unsubscribed and won’t receive The Weekly. Changed your mind?
            You can re-subscribe below.
          </p>
          <div className="manage-form__actions">
            <button className="btn btn--primary" onClick={() => change('resubscribe')} disabled={busy}>
              {busy ? 'Subscribing…' : 'Re-subscribe'}
            </button>
          </div>
        </>
      )}

      {subStatus === 'pending' && (
        <p className="manage-form__hint manage-form__hint--last">
          Your subscription isn’t confirmed yet — use the link in the
          confirmation email we sent you.
        </p>
      )}

      {error && (
        <p className="manage-form__status manage-form__status--error" role="alert">{error}</p>
      )}
    </div>
  )
}
