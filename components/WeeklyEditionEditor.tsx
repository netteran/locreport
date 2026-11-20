'use client'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { editionCompanySlug, replaceEditionCompany } from '@/lib/email/editionCompany'

type Copy = { editionDate: string; subject: string; body_markdown: string; saved: boolean; revision: string | null }
type Recipients = { recipients: number; skipped: number; articles: number }
const text = (copy: Copy) => JSON.stringify([copy.subject, copy.body_markdown])

export function WeeklyEditionEditor() {
  const [companies, setCompanies] = useState<{ slug: string; name: string }[] | null>(null)
  const [companyError, setCompanyError] = useState('')
  const [copy, setCopy] = useState<Copy | null>(null)
  const [savedText, setSavedText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [subscribers, setSubscribers] = useState<{ id: string; email: string }[]>([])
  const [to, setTo] = useState('')
  const [confirmation, setConfirmation] = useState<Recipients | null>(null)
  const dirty = !!copy && (!copy.saved || text(copy) !== savedText)
  const ready = !!copy?.saved && !dirty && !busy

  async function loadCompanies() {
    setCompanyError('')
    try {
      const response = await fetch('/api/digest/companies', { cache: 'no-store' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Could not load directory companies')
      setCompanies(data.companies)
    } catch (error) {
      setCompanyError((error as Error).message)
    }
  }

  async function chooseCompany(slug: string) {
    setBusy(true); setCompanyError(''); setConfirmation(null); setMessage('')
    try {
      const response = await fetch(`/api/digest/companies?slug=${encodeURIComponent(slug)}`, { cache: 'no-store' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Could not select the company')
      setCopy(current => current && { ...current, body_markdown: replaceEditionCompany(current.body_markdown, data.section) })
    } catch (error) {
      setCompanyError((error as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function load(refresh = false) {
    if (refresh && dirty && !window.confirm('Replace unsaved edits with the latest collected content? The saved edition will stay unchanged until you save again.')) return
    setBusy(true); setError(''); setConfirmation(null); setMessage('')
    try {
      const query = new URLSearchParams()
      if (refresh) {
        query.set('refresh', '1')
        const company = editionCompanySlug(copy?.body_markdown || '')
        if (company) query.set('exclude_company', company)
      }
      const r = await fetch(`/api/digest/edition${query.size ? '?' + query : ''}`, { cache: 'no-store' })
      const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Could not load edition')
      setCopy(d); setSavedText(d.saved ? text(d) : '')
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  useEffect(() => {
    load()
    loadCompanies()
    fetch('/api/digest/recipients').then(r => r.ok ? r.json() : { subscribers: [] }).then(d => setSubscribers(d.subscribers || [])).catch(() => {})
  }, [])
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    if (dirty) window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  function edit(field: 'subject' | 'body_markdown', value: string) {
    setCopy(c => c && { ...c, [field]: value }); setConfirmation(null); setMessage('')
  }
  async function save() {
    if (!copy) return
    setBusy(true); setError(''); setConfirmation(null)
    try {
      const r = await fetch('/api/digest/edition', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(copy) })
      const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Could not save edition')
      setCopy(d); setSavedText(text(d)); setMessage('Complete edition saved. Preview and Friday’s send will use this version.')
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  async function send(dry: boolean) {
    if (!ready || !copy || (!dry && !confirmation)) return
    setBusy(true); setError(''); setMessage('')
    try {
      const query = new URLSearchParams({ revision: copy.revision! })
      if (dry) query.set('dry', '1')
      if (to) query.set('to', to)
      const r = await fetch(`/api/digest/send?${query}`, { method: 'POST' })
      const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Could not process send')
      if (dry) setConfirmation(d)
      else { setConfirmation(null); setMessage(`Sent to ${d.sent} subscriber(s); ${d.skipped} skipped.${d.errors?.length ? ' Errors: ' + d.errors.join('; ') : ''}`) }
    } catch (e) { setConfirmation(null); setError((e as Error).message) } finally { setBusy(false) }
  }
  const currentCompany = editionCompanySlug(copy?.body_markdown ?? '')
  return <div className="admin-weekly-form">
    <p className="admin-page__subtitle">Edit the subject and the complete newsletter below. Use headings, paragraphs, lists, images and full https links. Save before previewing or sending.</p>
    <p className="text-xs" style={{ color: 'var(--muted)' }}>Friday at 13:00 Warsaw time: a saved edition replaces the automatic issue for that Friday. Without a saved edition, the existing automatic newsletter continues.</p>
    {error && <p role="alert">{error} <button onClick={() => load()}>Reload edition</button></p>}
    {!copy ? <p role="status">{busy ? 'Loading edition…' : 'The edition is unavailable.'}</p> : <>
      <div className="admin-weekly-actions"><strong>Edition {copy.editionDate}</strong><span role="status">{dirty ? 'Unsaved edition' : 'Saved edition'}</span>
        <Button variant="ghost" disabled={busy} onClick={() => load(true)}>Refresh from latest content</Button></div>
      <p className="text-xs" style={{ color: 'var(--muted)' }}>Refresh reloads the latest content and picks another directory company when available. Save the edition to update its preview and send.</p>
      <label>Subject<input aria-label="Subject" value={copy.subject} maxLength={200} disabled={busy} onChange={e => edit('subject', e.target.value)} /></label>
      <label>Company of the week
        <select
          aria-label="Company of the week"
          value={companies?.some(company => company.slug === currentCompany) ? currentCompany! : ''}
          disabled={busy || !companies?.length}
          onChange={event => chooseCompany(event.target.value)}
        >
          <option value="" disabled>{companies ? (companies.length ? 'Choose a directory company' : 'No directory companies available') : 'Loading directory companies…'}</option>
          {companies?.map(company => <option key={company.slug} value={company.slug}>{company.name}</option>)}
        </select>
      </label>
      <p className="text-xs" style={{ color: 'var(--muted)' }}>Choosing a company updates only its section. Save the edition to use the selection in the preview and send.</p>
      {companyError && <p role="alert">{companyError} {!companies && <button onClick={loadCompanies}>Retry loading companies</button>}</p>}
      <label>Newsletter content<textarea aria-label="Newsletter content" value={copy.body_markdown} maxLength={60000} disabled={busy} onChange={e => edit('body_markdown', e.target.value)} /></label>
      <div className="admin-weekly-actions">
        <Button disabled={busy || !copy.subject.trim() || !copy.body_markdown.trim()} onClick={save}>Save edition</Button>
        <Button variant="secondary" disabled={!ready} onClick={() => window.open(`/api/digest/preview?revision=${copy.revision}`, '_blank', 'noopener,noreferrer')}>View saved preview</Button>
        <select aria-label="Send to" value={to} disabled={busy} onChange={e => { setTo(e.target.value); setConfirmation(null) }}>
          <option value="">All subscribers ({subscribers.length})</option>{subscribers.map(s => <option key={s.id} value={s.id}>{s.email}</option>)}
        </select>
        <Button variant="secondary" disabled={!ready} onClick={() => send(true)}>Check recipients</Button>
      </div>
      {confirmation && <div className="admin-action__panel"><p>{confirmation.recipients} recipients · {confirmation.skipped} skipped. This sends the saved edition as real email.</p>
        <div className="admin-weekly-actions"><Button disabled={!ready || !confirmation.recipients} onClick={() => send(false)}>Confirm send</Button><Button variant="ghost" onClick={() => setConfirmation(null)}>Cancel</Button></div>
      </div>}
    </>}
    {message && <p role="status">{message}</p>}
  </div>
}
