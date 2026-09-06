'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { configJsonToFields } from '@/lib/scrapedSourceConfig'

const PLACEHOLDER = `{
  "articleSelector": ".post-card",
  "titleSelector": ".post-title",
  "linkSelector": "a",
  "descriptionSelector": ".post-excerpt",
  "dateSelector": "time",
  "contentFilter": { "keywords": ["translation", "localization"], "minMatches": 1 }
}`

const selectStyle: React.CSSProperties = {
  background: 'var(--surface)',
  borderColor: 'var(--border)',
  color: 'var(--text)',
}

export function ScrapedSourceForm({ onAdded }: { onAdded: () => void }) {
  const [name, setName] = useState('')
  const [type, setType] = useState<'html' | 'rss'>('html')
  const [url, setUrl] = useState('')
  const [configRaw, setConfigRaw] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    let config = {}
    if (configRaw.trim()) {
      try {
        config = JSON.parse(configRaw)
      } catch {
        setError('Config is not valid JSON.')
        return
      }
    }

    setLoading(true)
    const res = await fetch('/api/scraped-sources', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, type, url, ...configJsonToFields(config) }),
    })
    if (res.ok) {
      setName('')
      setUrl('')
      setConfigRaw('')
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
        <Label htmlFor="ss-name">Name</Label>
        <Input id="ss-name" value={name} onChange={e => setName(e.target.value)} placeholder="TAUS-Blog" required />
      </div>
      <div>
        <Label htmlFor="ss-type">Type</Label>
        <select
          id="ss-type"
          value={type}
          onChange={e => setType(e.target.value as 'html' | 'rss')}
          className="w-full rounded-lg border px-3 py-2 text-sm"
          style={selectStyle}
        >
          <option value="html">HTML listing page (CSS selectors)</option>
          <option value="rss">Existing RSS/Atom feed (re-filter by keyword)</option>
        </select>
      </div>
      <div>
        <Label htmlFor="ss-url">Source URL</Label>
        <Input id="ss-url" type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://example.com/blog/" required />
      </div>
      <div>
        <Label htmlFor="ss-config">
          Config <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(JSON, optional)</span>
        </Label>
        <Textarea
          id="ss-config"
          rows={8}
          value={configRaw}
          onChange={e => setConfigRaw(e.target.value)}
          placeholder={PLACEHOLDER}
          className="font-mono text-xs"
        />
        <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
          HTML type needs at least articleSelector, titleSelector and linkSelector (linkSelector can be the
          literal string &quot;self&quot; when the article element itself is the link). contentFilter works for
          either type: {'{ keywords: string[], minMatches?, checkFullContent?, maxScan? }'} — omit it to keep
          everything found.
        </p>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button type="submit" disabled={loading}>{loading ? 'Adding…' : 'Add source'}</Button>
    </form>
  )
}
