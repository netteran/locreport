'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { marked } from 'marked'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

function clientSlugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
}

export default function DirectComposePage() {
  const router = useRouter()

  const [title, setTitle] = useState('')
  const [slug, setSlug] = useState('')
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false)
  const [publisher, setPublisher] = useState('LocReport')
  const [content, setContent] = useState('')
  const [contentType] = useState('industry')
  const [sourceUrl, setSourceUrl] = useState('')
  const [sourceName, setSourceName] = useState('')
  const [extraUrl1, setExtraUrl1] = useState('')
  const [extraSourceName1, setExtraSourceName1] = useState('')
  const [extraUrl2, setExtraUrl2] = useState('')
  const [extraSourceName2, setExtraSourceName2] = useState('')

  const [tab, setTab] = useState<'write' | 'preview'>('write')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  function handleTitleChange(value: string) {
    setTitle(value)
    if (!slugManuallyEdited) setSlug(clientSlugify(value))
  }

  async function submit() {
    if (!title.trim() || !content.trim()) return
    setSubmitting(true)
    setError('')

    try {
      const res = await fetch('/api/direct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          slug: slug || undefined,
          publisher,
          content,
          contentType,
          sourceUrl,
          sourceName,
          extraUrl1,
          extraSourceName1,
          extraUrl2,
          extraSourceName2,
        }),
      })

      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.error ?? `Error ${res.status}`)
        setSubmitting(false)
        return
      }

      const { draft, classification, contentType: ct } = await res.json()

      const params = new URLSearchParams()
      if (classification?.impact_score) params.set('impact_score', String(classification.impact_score))
      if (classification?.time_horizon) params.set('time_horizon', classification.time_horizon)
      if (ct) params.set('content_type', ct)
      if (classification?.signal_ids?.length) params.set('signal_ids', classification.signal_ids.join(','))
      const qs = params.toString()

      router.push('/admin/drafts')
    } catch {
      setError('Network error — please try again.')
      setSubmitting(false)
    }
  }

  return (
    <div className="max-w-[760px]">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--text)]">Direct entry</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
          Paste article content as-is. AI will classify significance and time relevance without touching the text.
        </p>
      </div>

      <div className="flex flex-col gap-5">
        <div>
          <Label htmlFor="title">Title <span className="text-red-500">*</span></Label>
          <Input
            id="title"
            value={title}
            onChange={e => handleTitleChange(e.target.value)}
            placeholder="Article title"
            className="mt-1"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="slug">Slug</Label>
            <Input
              id="slug"
              value={slug}
              onChange={e => { setSlug(e.target.value); setSlugManuallyEdited(true) }}
              placeholder="auto-generated-from-title"
              className="mt-1 font-mono text-sm"
            />
          </div>
          <div>
            <Label htmlFor="publisher">Publisher</Label>
            <Input
              id="publisher"
              value={publisher}
              onChange={e => setPublisher(e.target.value)}
              placeholder="LocReport"
              className="mt-1"
            />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <Label htmlFor="content">Article content <span className="text-red-500">*</span></Label>
            <div className="flex gap-1" style={{ borderBottom: '1px solid var(--border)' }}>
              {(['write', 'preview'] as const).map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className="px-3 py-1 text-xs font-medium capitalize rounded-t"
                  style={tab === t
                    ? { borderBottom: '2px solid var(--accent)', color: 'var(--accent)', marginBottom: -1 }
                    : { color: 'var(--muted)' }}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          {tab === 'write' ? (
            <Textarea
              id="content"
              value={content}
              onChange={e => setContent(e.target.value)}
              rows={18}
              placeholder="Paste the full article text here. It will be published exactly as written."
              className="mt-1 font-mono text-sm"
            />
          ) : (
            <div
              className="prose mt-1 min-h-[18rem] rounded-md border p-4 text-sm overflow-auto"
              style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
              dangerouslySetInnerHTML={{ __html: content ? marked.parse(content) as string : '<p style="color:var(--muted)">Nothing to preview yet.</p>' }}
            />
          )}
          <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
            Supports Markdown. Content is published unchanged.
          </p>
        </div>

        <div className="border-t pt-4" style={{ borderColor: 'var(--border)' }}>
          <p className="text-sm font-medium mb-3" style={{ color: 'var(--text)' }}>Sources (up to 3)</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div>
              <Label htmlFor="source-url">Source URL 1</Label>
              <Input id="source-url" value={sourceUrl} onChange={e => setSourceUrl(e.target.value)} placeholder="https://…" className="mt-1" />
            </div>
            <div>
              <Label htmlFor="source-name">Source name 1</Label>
              <Input id="source-name" value={sourceName} onChange={e => setSourceName(e.target.value)} placeholder="e.g. Slator" className="mt-1" />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div>
              <Label htmlFor="extra-url-1">Source URL 2</Label>
              <Input id="extra-url-1" value={extraUrl1} onChange={e => setExtraUrl1(e.target.value)} placeholder="https://…" className="mt-1" />
            </div>
            <div>
              <Label htmlFor="extra-name-1">Source name 2</Label>
              <Input id="extra-name-1" value={extraSourceName1} onChange={e => setExtraSourceName1(e.target.value)} placeholder="Optional" className="mt-1" />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="extra-url-2">Source URL 3</Label>
              <Input id="extra-url-2" value={extraUrl2} onChange={e => setExtraUrl2(e.target.value)} placeholder="https://…" className="mt-1" />
            </div>
            <div>
              <Label htmlFor="extra-name-2">Source name 3</Label>
              <Input id="extra-name-2" value={extraSourceName2} onChange={e => setExtraSourceName2(e.target.value)} placeholder="Optional" className="mt-1" />
            </div>
          </div>
        </div>

        {error && (
          <p className="text-sm text-red-600">{error}</p>
        )}

        <div className="flex items-center gap-3">
          <Button
            onClick={submit}
            disabled={submitting || !title.trim() || !content.trim()}
          >
            {submitting ? 'Classifying & saving…' : 'Save to drafts'}
          </Button>
          <span className="text-xs" style={{ color: 'var(--muted)' }}>
            AI will assign impact score, time horizon, and signals — then send to draft review.
          </span>
        </div>
      </div>
    </div>
  )
}
