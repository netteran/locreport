'use client'

import { useCallback, useEffect, useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { WEEKLY_NOTE_LIMIT } from '@/lib/email/weeklyNote'

type Note = { editionDate: string; paragraph: string }

export function WeeklyNoteEditor({ disabled, onReadyChange, onEdit }: {
  disabled: boolean
  onReadyChange: (ready: boolean) => void
  onEdit: () => void
}) {
  const id = useId()
  const [saved, setSaved] = useState<Note | null>(null)
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const dirty = saved !== null && text !== saved.paragraph

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    onReadyChange(false)
    try {
      const response = await fetch('/api/digest/note', { cache: 'no-store' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Could not load paragraph')
      setSaved(data)
      setText(data.paragraph)
      onReadyChange(true)
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not load paragraph')
    } finally {
      setLoading(false)
    }
  }, [onReadyChange])

  useEffect(() => { void load() }, [load])

  async function save() {
    if (!saved) return
    setSaving(true)
    setError('')
    setMessage('')
    onReadyChange(false)
    try {
      const response = await fetch('/api/digest/note', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ editionDate: saved.editionDate, paragraph: text })
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Could not save paragraph')
      setSaved(data)
      setText(data.paragraph)
      setMessage(data.paragraph ? 'Paragraph saved for this edition.' : 'Paragraph removed from this edition.')
      onReadyChange(true)
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not save paragraph')
    } finally {
      setSaving(false)
    }
  }

  const edition = saved ? new Date(`${saved.editionDate}T12:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Warsaw'
  }) : null

  return (
    <div className="admin-weekly-note">
      <div className="admin-weekly-note__heading">
        <label htmlFor={id}>Opening paragraph <span>Optional</span></label>
        {edition && <span>Edition: {edition}</span>}
      </div>
      <p id={`${id}-help`}>Add your own introduction above the top story. Saved text is used in the sample, manual sends and the scheduled Friday send. It won’t carry over to next week. Format with **bold**, *italics* and [link text](https://example.com).</p>
      <Textarea id={id} aria-describedby={`${id}-help`} rows={3} maxLength={WEEKLY_NOTE_LIMIT}
        placeholder={loading ? 'Loading paragraph…' : 'A short note with **bold**, *italics* or [a link](https://example.com)…'}
        value={text} disabled={disabled || loading || saving || !saved}
        onChange={event => {
          const value = event.target.value
          setText(value)
          setMessage('')
          onReadyChange(saved !== null && value === saved.paragraph)
          onEdit()
        }} />
      <div className="admin-weekly-note__footer">
        <span>{text.length} / {WEEKLY_NOTE_LIMIT}{dirty ? ' · Save changes before previewing or sending' : ''}</span>
        <div>
          {error && <Button size="sm" variant="ghost" disabled={disabled || saving || loading} onClick={load}>Reload saved paragraph</Button>}
          <Button size="sm" variant="secondary" disabled={disabled || saving || loading || !dirty} onClick={save}>
            {saving ? 'Saving…' : 'Save paragraph'}
          </Button>
        </div>
      </div>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
    </div>
  )
}
