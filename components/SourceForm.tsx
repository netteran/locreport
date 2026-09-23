'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { PODCAST_CONFIG_TEMPLATE } from '@/lib/podcastConfig'

type Kind = 'feed' | 'podcast'

export function SourceForm({ onAdded }: { onAdded: () => void }) {
  const [kind, setKind] = useState<Kind>('feed')
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const [keywordsRaw, setKeywordsRaw] = useState('')
  const [configText, setConfigText] = useState(() => JSON.stringify(PODCAST_CONFIG_TEMPLATE, null, 2))
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
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div>
        <Label htmlFor="src-kind">Type</Label>
        <select
          id="src-kind"
          value={kind}
          onChange={e => setKind(e.target.value as Kind)}
          className="w-full rounded-md px-3 py-2 text-sm"
          style={{ background: 'var(--surface, var(--bg))', color: 'var(--text)', border: '1px solid var(--border)' }}
        >
          <option value="feed">News feed — ingested on schedule</option>
          <option value="podcast">Podcast — manual drafts only</option>
        </select>
      </div>
      <div>
        <Label htmlFor="src-name">{kind === 'podcast' ? 'Podcast name' : 'Feed name'}</Label>
        <Input id="src-name" value={name} onChange={e => setName(e.target.value)} placeholder={kind === 'podcast' ? 'The Signal Room Podcast' : 'SlatorPod'} required />
      </div>
      <div>
        <Label htmlFor="src-url">{kind === 'podcast' ? 'Podcast audio RSS or YouTube channel feed URL' : 'RSS URL'}</Label>
        <Input
          id="src-url"
          type="url"
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder={kind === 'podcast' ? 'https://anchor.fm/s/…/podcast/rss' : 'https://slator.com/feed'}
          required
        />
        {kind === 'podcast' && (
          <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
            An audio RSS feed lets episodes be transcribed automatically. A YouTube channel feed
            (https://www.youtube.com/feeds/videos.xml?channel_id=UC…) works too, but then each transcript has to be pasted in.
          </p>
        )}
      </div>
      {kind === 'feed' ? (
        <div>
          <Label htmlFor="src-keywords">Keywords filter <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(optional)</span></Label>
          <Input
            id="src-keywords"
            value={keywordsRaw}
            onChange={e => setKeywordsRaw(e.target.value)}
            placeholder="translate, translation, localization, linguistics"
          />
          <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
            Comma-separated. If set, only RSS items whose title or description contains at least one keyword will be ingested.
          </p>
        </div>
      ) : (
        <div>
          <Label htmlFor="src-config">Podcast config (JSON)</Label>
          <Textarea id="src-config" value={configText} onChange={e => setConfigText(e.target.value)} rows={14} className="font-mono text-xs" />
          <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
            People and platform links the article may use — any other link the writer produces is stripped. Never ingested on
            schedule: drafts are generated one episode at a time from this page.
          </p>
        </div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button type="submit" disabled={loading}>{loading ? 'Adding…' : 'Add source'}</Button>
    </form>
  )
}
