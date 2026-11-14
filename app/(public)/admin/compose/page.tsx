'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArticleEditor } from '@/components/ArticleEditor'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
type Stage = 'form' | 'facts' | 'article'

function clientSlugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
}


export default function ComposePage() {
  const router = useRouter()

  // Input form fields
  const [articleContent, setArticleContent] = useState('')
  const [title, setTitle] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [sourceName, setSourceName] = useState('')
  const [extraUrl1, setExtraUrl1] = useState('')
  const [extraSourceName1, setExtraSourceName1] = useState('')
  const [extraUrl2, setExtraUrl2] = useState('')
  const [extraSourceName2, setExtraSourceName2] = useState('')
  const [contentType] = useState('industry')
  const [impactScore, setImpactScore] = useState('')
  const [timeHorizon, setTimeHorizon] = useState('')
  const [extraPrompt, setExtraPrompt] = useState('')

  // Article-stage metadata (AI-populated, admin-editable)
  const [editTitle, setEditTitle] = useState('')
  const [editSlug, setEditSlug] = useState('')
  const [editPublisher, setEditPublisher] = useState('LocReport')
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false)

  // Pipeline state
  const [stage, setStage] = useState<Stage>('form')
  const [facts, setFacts] = useState('')
  const [content, setContent] = useState('')
  const [extracting, setExtracting] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [publishError, setPublishError] = useState('')

  async function extractFacts() {
    if (!articleContent.trim()) return
    setExtracting(true)
    const res = await fetch('/api/compose', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage: 'extract', articleContent, sourceUrl, contentType }),
    })
    const data = await res.json()
    setFacts(data.facts ?? '')
    setStage('facts')
    setExtracting(false)
  }

  async function generateArticle() {
    setGenerating(true)
    const res = await fetch('/api/compose', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage: 'generate', facts, title, sourceUrl, sourceName, extraUrl1, extraSourceName1, extraUrl2, extraSourceName2, extraPrompt, contentType }),
    })
    const data = await res.json()
    const generated = data.content ?? ''
    setContent(generated)

    // Pre-fill metadata — API returns resolved title (H1 or AI-generated)
    const resolvedTitle = data.title?.trim() || generated.match(/^#\s+(.+)$/m)?.[1]?.trim() || title.trim()
    setEditTitle(resolvedTitle)
    if (!slugManuallyEdited) setEditSlug(clientSlugify(resolvedTitle))

    if (!impactScore && data.impact_score) setImpactScore(String(data.impact_score))
    if (!timeHorizon && data.time_horizon) setTimeHorizon(data.time_horizon)
    setStage('article')
    setGenerating(false)
  }

  function handleEditTitleChange(value: string) {
    setEditTitle(value)
    if (!slugManuallyEdited) setEditSlug(clientSlugify(value))
  }

  async function save(finalContent: string, redirectToDraft = false) {
    setPublishing(true)
    setPublishError('')
    try {
      const res = await fetch('/api/drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: finalContent,
          source_url: sourceUrl || null,
          title: editTitle || undefined,
        }),
      })
      const draft = await res.json()
      if (!res.ok || !draft?.id) {
        setPublishError(draft?.error ?? `Failed to save draft (HTTP ${res.status})`)
        setPublishing(false)
        return
      }
      if (!redirectToDraft) {
        router.push('/admin/drafts')
        return
      }
      const params = new URLSearchParams()
      if (impactScore) params.set('impact_score', impactScore)
      if (timeHorizon) params.set('time_horizon', timeHorizon)
      params.set('content_type', contentType)
      if (editSlug) params.set('slug', editSlug)
      if (editPublisher) params.set('publisher', editPublisher)
      router.push(`/admin/drafts/${draft.id}?${params.toString()}`)
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : 'Network error')
    }
    setPublishing(false)
  }

  if (stage === 'article' && content) {
    return (
      <div className="max-w-[760px]">
        <div className="flex items-center gap-3 mb-6">
          <h1 className="text-2xl font-bold text-[var(--text)]">Compose</h1>
          <button onClick={() => setStage('facts')} className="text-sm hover:underline" style={{ color: 'var(--accent)' }}>← Back to facts</button>
        </div>

        {/* AI-generated metadata — editable before saving */}
        <div className="flex flex-col gap-4 mb-6">
          <div>
            <Label htmlFor="edit-title">Title</Label>
            <Input
              id="edit-title"
              value={editTitle}
              onChange={e => handleEditTitleChange(e.target.value)}
              className="mt-1"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="edit-slug">Slug</Label>
              <Input
                id="edit-slug"
                value={editSlug}
                onChange={e => { setEditSlug(e.target.value); setSlugManuallyEdited(true) }}
                className="mt-1 font-mono text-sm"
              />
            </div>
            <div>
              <Label htmlFor="edit-publisher">Publisher</Label>
              <Input
                id="edit-publisher"
                value={editPublisher}
                onChange={e => setEditPublisher(e.target.value)}
                className="mt-1"
              />
            </div>
          </div>
        </div>

        {publishError && (
          <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {publishError}
          </div>
        )}
        <ArticleEditor
          initialContent={content}
          onPublish={c => save(c, true)}
          onSaveDraft={c => save(c, false)}
          loading={publishing}
        />
      </div>
    )
  }

  return (
    <div className="max-w-[760px]">
      <h1 className="text-2xl font-bold text-[var(--text)] mb-6">Compose</h1>

      {stage === 'form' && (
        <div className="flex flex-col gap-5">
          <div>
            <Label htmlFor="article-content">Article content <span className="text-red-500">*</span></Label>
            <Textarea
              id="article-content"
              value={articleContent}
              onChange={e => setArticleContent(e.target.value)}
              rows={10}
              placeholder="Paste the full article text here…"
              className="mt-1"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="title">Suggested title</Label>
              <Input id="title" value={title} onChange={e => setTitle(e.target.value)} placeholder="Optional — AI will generate one if empty" className="mt-1" />
            </div>
            </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="source-url">Source URL</Label>
              <Input id="source-url" value={sourceUrl} onChange={e => setSourceUrl(e.target.value)} placeholder="https://…" className="mt-1" />
            </div>
            <div>
              <Label htmlFor="source-name">Source name</Label>
              <Input id="source-name" value={sourceName} onChange={e => setSourceName(e.target.value)} placeholder="e.g. Slator" className="mt-1" />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="extra-url-1">Extra source URL 1</Label>
              <Input id="extra-url-1" value={extraUrl1} onChange={e => setExtraUrl1(e.target.value)} placeholder="https://…" className="mt-1" />
            </div>
            <div>
              <Label htmlFor="extra-name-1">Extra source name 1</Label>
              <Input id="extra-name-1" value={extraSourceName1} onChange={e => setExtraSourceName1(e.target.value)} placeholder="Optional" className="mt-1" />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="extra-url-2">Extra source URL 2</Label>
              <Input id="extra-url-2" value={extraUrl2} onChange={e => setExtraUrl2(e.target.value)} placeholder="https://…" className="mt-1" />
            </div>
            <div>
              <Label htmlFor="extra-name-2">Extra source name 2</Label>
              <Input id="extra-name-2" value={extraSourceName2} onChange={e => setExtraSourceName2(e.target.value)} placeholder="Optional" className="mt-1" />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="impact-score">Impact score (1–5)</Label>
              <select
                id="impact-score"
                value={impactScore}
                onChange={e => setImpactScore(e.target.value)}
                className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
              >
                <option value="">Select…</option>
                {[1,2,3,4,5].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div>
              <Label htmlFor="time-horizon">Time horizon</Label>
              <select
                id="time-horizon"
                value={timeHorizon}
                onChange={e => setTimeHorizon(e.target.value)}
                className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-sm"
              >
                <option value="">Select…</option>
                <option value="now">Now</option>
                <option value="6months">6 months</option>
                <option value="2years">2 years</option>
              </select>
            </div>
          </div>

          <div>
            <Label htmlFor="extra-prompt">Additional prompt instructions</Label>
            <Textarea
              id="extra-prompt"
              value={extraPrompt}
              onChange={e => setExtraPrompt(e.target.value)}
              rows={3}
              placeholder="Optional extra instructions appended to the generation prompt…"
              className="mt-1"
            />
          </div>

          <div>
            <Button onClick={extractFacts} disabled={extracting || !articleContent.trim()}>
              {extracting ? 'Extracting facts…' : 'Step 1: Extract facts'}
            </Button>
          </div>
        </div>
      )}

      {stage === 'facts' && (
        <div className="flex flex-col gap-5">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-[var(--text)]">Extracted facts</h2>
            <button onClick={() => setStage('form')} className="text-sm hover:underline" style={{ color: 'var(--accent)' }}>← Edit inputs</button>
          </div>
          <Textarea
            value={facts}
            onChange={e => setFacts(e.target.value)}
            rows={20}
            className="font-mono text-xs"
          />
          <div className="flex gap-3">
            <Button onClick={generateArticle} disabled={generating || !facts.trim()}>
              {generating ? 'Generating article…' : 'Step 2: Generate article'}
            </Button>
            <Button variant="secondary" onClick={() => setStage('form')}>Back</Button>
          </div>
        </div>
      )}
    </div>
  )
}
