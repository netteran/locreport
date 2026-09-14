'use client'

import { useState } from 'react'
import { SIGNALS } from '@/lib/signals'

interface Prefs {
  signal_prefs: string[]
  include_summary: boolean
  min_impact: number
}

export default function ManageForm({ token, initial }: { token: string; initial: Prefs }) {
  const [signalPrefs, setSignalPrefs] = useState<string[]>(initial.signal_prefs)
  const [includeSummary, setIncludeSummary] = useState(initial.include_summary)
  const [minImpact, setMinImpact] = useState(initial.min_impact)
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'unsubscribed' | 'error'>('idle')
  const [error, setError] = useState('')

  // The digest can't be empty: without the general summary, at least one
  // signal briefing has to be selected. The API enforces this too.
  const empty = !includeSummary && signalPrefs.length === 0

  function toggleSignal(id: string) {
    setSignalPrefs(prev => (prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]))
    setStatus('idle')
  }

  async function save() {
    if (empty) return
    setStatus('saving')
    setError('')
    try {
      const res = await fetch('/api/subscribe/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          signal_prefs: signalPrefs,
          include_summary: includeSummary,
          min_impact: minImpact,
        }),
      })
      if (res.ok) {
        setStatus('saved')
        return
      }
      const data = await res.json().catch(() => ({}))
      setError(data.error ?? '')
      setStatus('error')
    } catch {
      setStatus('error')
    }
  }

  async function unsubscribe() {
    setStatus('saving')
    setError('')
    try {
      const res = await fetch('/api/subscribe/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, unsubscribe: true }),
      })
      setStatus(res.ok ? 'unsubscribed' : 'error')
    } catch {
      setStatus('error')
    }
  }

  if (status === 'unsubscribed') {
    return (
      <p className="subscribe-status__text">
        You’ve been unsubscribed. You can re-activate anytime by saving
        preferences from this page or subscribing again.
      </p>
    )
  }

  return (
    <div className="manage-form">
      <section className="manage-form__section">
        <h2 className="manage-form__heading">What you receive</h2>
        <p className="manage-form__hint">
          Every issue leads with the week’s top story. Choose what follows it.
        </p>

        <label className="manage-form__option">
          <input
            type="checkbox"
            checked={includeSummary}
            onChange={e => { setIncludeSummary(e.target.checked); setStatus('idle') }}
          />
          <span>
            <span className="manage-form__option-title">The week in brief</span>
            <span className="manage-form__option-desc">
              A general summary — everything we published that week, impact-ranked.
            </span>
          </span>
        </label>
      </section>

      <section className="manage-form__section">
        <h2 className="manage-form__heading">Signal briefings</h2>
        <p className="manage-form__hint">
          Add a dedicated section for each trend you follow. Leave them all
          unchecked to receive the general summary only.
          {!includeSummary && ' With the summary switched off, your issues cover these signals only.'}
        </p>
        <div className="manage-form__signals">
          {SIGNALS.map(s => (
            <label key={s.id} className="manage-form__signal">
              <input
                type="checkbox"
                checked={signalPrefs.includes(s.id)}
                onChange={() => toggleSignal(s.id)}
              />
              <span>
                <span className="manage-form__signal-title">{s.title}</span>
                <span className="manage-form__signal-cat">{s.category}</span>
              </span>
            </label>
          ))}
        </div>
      </section>

      <section className="manage-form__section">
        <h2 className="manage-form__heading">Minimum impact</h2>
        <p className="manage-form__hint">Only include stories at or above this impact level.</p>
        <select
          className="filter-select"
          value={minImpact}
          onChange={e => { setMinImpact(parseInt(e.target.value, 10)); setStatus('idle') }}
        >
          <option value={1}>All stories</option>
          <option value={2}>Notable and above</option>
          <option value={3}>Significant and above</option>
          <option value={4}>Major and above</option>
          <option value={5}>Disruptive only</option>
        </select>
      </section>

      <section className="manage-form__section">
        <h2 className="manage-form__heading">Delivery</h2>
        <p className="manage-form__hint manage-form__hint--last">
          One email a week, sent on Fridays.
        </p>
      </section>

      {empty && (
        <p className="manage-form__status manage-form__status--error" role="alert">
          Pick at least one signal, or keep the week in brief switched on — otherwise
          there would be nothing to send.
        </p>
      )}

      <div className="manage-form__actions">
        <button className="btn btn--primary" onClick={save} disabled={status === 'saving' || empty}>
          {status === 'saving' ? 'Saving…' : 'Save preferences'}
        </button>
        <button className="btn btn--ghost manage-form__unsub" onClick={unsubscribe} disabled={status === 'saving'}>
          Unsubscribe
        </button>
      </div>
      {status === 'saved' && <p className="manage-form__status" role="status">Preferences saved.</p>}
      {status === 'error' && (
        <p className="manage-form__status manage-form__status--error" role="alert">
          {error || 'Something went wrong — please try again.'}
        </p>
      )}
    </div>
  )
}
