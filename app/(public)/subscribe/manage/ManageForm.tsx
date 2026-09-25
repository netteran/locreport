'use client'

import { useState } from 'react'

export default function ManageForm({ token, initialStatus }: { token: string; initialStatus: string }) {
  const [subStatus, setSubStatus] = useState(initialStatus)
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
      if (res.ok) setSubStatus(data.status)
      else setError(data.error ?? 'Something went wrong — please try again.')
    } catch {
      setError('Something went wrong — please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="manage-form">
      <section className="manage-form__section">
        {subStatus === 'active' && (
          <p className="manage-form__hint manage-form__hint--last">
            You get The Weekly every Friday: the top story, how every signal we
            track moved, the week’s key facts, market and directory news when
            there is any, and everything else we published.
          </p>
        )}
        {subStatus === 'unsubscribed' && (
          <p className="manage-form__hint manage-form__hint--last">
            You’re unsubscribed and won’t receive The Weekly. Changed your mind?
            You can re-subscribe below.
          </p>
        )}
        {subStatus === 'pending' && (
          <p className="manage-form__hint manage-form__hint--last">
            Your subscription isn’t confirmed yet — use the link in the
            confirmation email we sent you.
          </p>
        )}
      </section>

      <div className="manage-form__actions">
        {subStatus === 'active' && (
          <button className="btn btn--ghost manage-form__unsub" onClick={() => change('unsubscribe')} disabled={busy}>
            {busy ? 'Unsubscribing…' : 'Unsubscribe'}
          </button>
        )}
        {subStatus === 'unsubscribed' && (
          <button className="btn btn--primary" onClick={() => change('resubscribe')} disabled={busy}>
            {busy ? 'Subscribing…' : 'Re-subscribe'}
          </button>
        )}
      </div>
      {error && (
        <p className="manage-form__status manage-form__status--error" role="alert">{error}</p>
      )}
    </div>
  )
}
