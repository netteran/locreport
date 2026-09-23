'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { PODCAST_CONFIG_TEMPLATE } from '@/lib/podcastConfig'

type Kind = 'feed' | 'podcast'

const FIELD = 'px-2 py-1 text-xs rounded-md'

// Compact add-source form, shown from the "+ Add" button on /admin/sources.
export function SourceForm({ onAdded, onCancel }: { onAdded: () => void; onCancel?: () => void }) {
  const [kind, setKind] = useState<Kind>('feed')
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const [keywordsRaw, setKeywordsRaw] = useState('')
  // New podcast sources start baselined at "now", so enabling Auto can never
  // sweep the channel's whole back catalogue.
  const [configText, setConfigText] = useState(() =>
    JSON.stringify({ ...PODCAST_CONFIG_TEMPLATE, ignore_before: new Date().toISOString().slice(0, 19) + 'Z' }, null, 2))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    let payload: Record<string, unknown>
    if (kind === 'podcast') {
      let podcast_config: unknown
      try {
        podcast_config = JSON.parse(configText)
      } catch {
        setError('Podcast config is not valid JSON')
        setLoading(false)
        return
      }
      payload = { url, name, kind, podcast_config }
    } else {
      const keywords = keywordsRaw
        .split(',')
        .map(k => k.trim().toLowerCase())
        .filter(Boolean)
      payload = { url, name, keywords }
    }
    const res = await fetch('/api/sources', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (res.ok) {
      setUrl('')
      setName('')
      setKeywordsRaw('')
      onAdded()
    } else {
      const data = await res.json()
      setError(data.error ?? 'Failed to add source')
    }
    setLoading(false)
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-1.5">
      <div className="grid gap-1.5 sm:grid-cols-[8rem_12rem_1fr]">
        <select
          aria-label="Type"
          value={kind}
          onChange={e => setKind(e.target.value as Kind)}
          className={`${FIELD} border`}
          style={{ background: 'var(--surface, var(--bg))', color: 'var(--text)', borderColor: 'var(--border)' }}
        >
          <option value="feed">News feed</option>
          <option value="podcast">Podcast</option>
        </select>
        <Input aria-label="Name" className={FIELD} value={name} onChange={e => setName(e.target.value)} placeholder={kind === 'podcast' ? 'Podcast name' : 'Feed name'} required />
        <Input
          aria-label="URL"
          className={FIELD}
          type="url"
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder={kind === 'podcast' ? 'https://www.youtube.com/feeds/videos.xml?channel_id=UC… (or a podcast audio RSS)' : 'RSS URL, e.g. https://slator.com/feed'}
          required
        />
      </div>
      {kind === 'feed' ? (
        <Input
          aria-label="Keywords"
          className={FIELD}
          value={keywordsRaw}
          onChange={e => setKeywordsRaw(e.target.value)}
          placeholder="Keyword filter, comma-separated (optional) — only items mentioning one are ingested"
        />
      ) : (
        <>
          <Textarea aria-label="Podcast config" value={configText} onChange={e => setConfigText(e.target.value)} rows={10} className={`${FIELD} font-mono`} />
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            People and platform links the article may use (any other link is stripped). <code>ignore_before</code> marks everything
            up to that moment as already seen. With Auto ticked, newer full episodes are generated and published on the scheduled runs.
          </p>
        </>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-1">
        <Button size="xs" type="submit" disabled={loading}>{loading ? 'Adding…' : 'Add source'}</Button>
        {onCancel && <Button size="xs" type="button" variant="ghost" onClick={onCancel}>Cancel</Button>}
      </div>
    </form>
  )
}
