'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { marked } from 'marked'
import { Draft } from '@/lib/types'
import { ImageDropzone } from '@/components/ImageDropzone'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

// The draft's Fact Flow fact, as returned alongside the draft by GET/PATCH
// /api/drafts/[id] (see lib/factFlow.ts findDraftFact). Not part of the Draft
// type itself — the facts table is a separate row joined in for this screen.
interface DraftFact {
  id: string
  content: string
  source_url: string | null
  source_name: string | null
  article_id: string | null
  created_at: string
}

function clientSlugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
}

export default function DraftReviewPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [tab, setTab] = useState<'write' | 'preview'>('write')
  const [content, setContent] = useState('')

  // Metadata fields
  const [editTitle, setEditTitle] = useState('')
  const [editSlug, setEditSlug] = useState(() => searchParams.get('slug') ?? '')
  const [editPublisher, setEditPublisher] = useState(() => searchParams.get('publisher') ?? 'LocReport')
  const [editSourceUrl, setEditSourceUrl] = useState('')
  const [editImageUrl, setEditImageUrl] = useState('')
  const [editImageAlt, setEditImageAlt] = useState('')
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(() => !!searchParams.get('slug'))

  const [impactScore, setImpactScore] = useState(() => searchParams.get('impact_score') ?? '')
  const [timeHorizon, setTimeHorizon] = useState(() => searchParams.get('time_horizon') ?? '')
  const contentType = searchParams.get('content_type') ?? 'industry'
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [rerunning, setRerunning] = useState(false)
  const [confirmRerun, setConfirmRerun] = useState(false)
  // Optional extra direction for Stage 2 only — kept between re-runs so the wording can be
  // iterated on without retyping it.
  const [rerunInstruction, setRerunInstruction] = useState('')
  const [rerunNote, setRerunNote] = useState('')
  const [error, setError] = useState('')

  // The draft's Fact Flow fact — reviewed and edited alongside the article body.
  // Kept as plain state (not read off `draft.fact` at render time) because a
  // re-run replaces `draft` wholesale with a response that carries no `fact`
  // field, and the fact is untouched by a re-run (only Stage 2 prose changes).
  const [factContent, setFactContent] = useState('')
  const [factPublished, setFactPublished] = useState(false)

  useEffect(() => {
    fetch(`/api/drafts/${id}`)
      .then(r => r.json())
      .then((d: Draft & { fact: DraftFact | null }) => {
        setDraft(d)
        // Strip leading H1 from content (legacy drafts may still have it)
        const strippedContent = d.content.replace(/^#\s+.+\n?/, '').trimStart()
        setContent(strippedContent)
        setEditTitle(d.title || '')
        setEditSlug(clientSlugify(d.title || ''))
        setEditSourceUrl(d.source_url ?? '')
        setEditImageUrl(d.image_url ?? '')
        setEditImageAlt(d.image_alt ?? '')
        setFactContent(d.fact?.content ?? '')
        setFactPublished(!!d.fact?.article_id)
      })
      .catch(() => setError('Failed to load draft.'))
  }, [id])

  // Auto-update slug when title changes (unless manually edited)
  useEffect(() => {
    if (!slugManuallyEdited) {
      setEditSlug(clientSlugify(editTitle))
    }
  }, [editTitle, slugManuallyEdited])

  async function saveDraft() {
    setSaving(true)
    setError('')
    try {
      const res = await fetch(`/api/drafts/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content,
          title: editTitle || undefined,
          source_url: editSourceUrl || null,
          image_url: editImageUrl.trim() || null,
          image_alt: editImageAlt.trim() || null,
          fact: factContent,
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.error ?? `Save failed (${res.status})`)
      } else {
        const updated: Draft & { fact: DraftFact | null } = await res.json()
        setFactPublished(!!updated.fact?.article_id)
        setSavedAt(new Date())
      }
    } catch {
      setError('Network error — please try again.')
    }
    setSaving(false)
  }

  async function action(status: 'approved' | 'rejected') {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/drafts/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status,
          content,
          title: editTitle || undefined,
          slug: editSlug || undefined,
          publisher: editPublisher || undefined,
          source_url: editSourceUrl || null,
          image_url: editImageUrl.trim() || null,
          image_alt: editImageAlt.trim() || null,
          impact_score: impactScore ? Number(impactScore) : null,
          time_horizon: timeHorizon || null,
          content_type: contentType,
          fact: factContent,
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.error ?? `Server error (${res.status})`)
        setLoading(false)
        return
      }
    } catch {
      setError('Network error — please try again.')
      setLoading(false)
      return
    }
    router.push('/admin/drafts')
  }

  async function rerun() {
    const instruction = rerunInstruction.trim()
    setConfirmRerun(false)
    setRerunning(true)
    setError('')
    setRerunNote('')
    setDraft(d => d ? { ...d, status: 'rerunning' } : d)
    try {
      const res = await fetch(`/api/drafts/${id}/rerun`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.error ?? `Re-run failed (${res.status})`)
        setDraft(d => d ? { ...d, status: 'pending' } : d)
        setRerunning(false)
        return
      }
      const updated: Draft & { facts_reused?: boolean } = await res.json()
      setDraft(updated)
      setContent(updated.content)
      const h1 = updated.content.match(/^#\s+(.+)$/m)?.[1]?.trim()
      const resolvedTitle = h1 || updated.title || ''
      setEditTitle(resolvedTitle)
      setSlugManuallyEdited(false)
      setTab('preview')
      setRerunNote([
        instruction ? 'Re-run with your extra instruction.' : 'Re-run with the prompt as is.',
        updated.facts_reused
          ? 'Stage 1 facts reused unchanged.'
          : 'No stored fact sheet — facts were extracted once and pinned to this draft for future re-runs.',
      ].join(' '))
    } catch {
      setError('Network error during re-run.')
      setDraft(d => d ? { ...d, status: 'pending' } : d)
    }
    setRerunning(false)
  }

  if (!draft) return <p className="text-[#5B665F]">Loading…</p>

  const isPending = draft.status === 'pending' || draft.status === 'rerun'

  // Detect numbers/statistics in content so reviewer can verify against source
  const suspectNumbers = (() => {
    const matches: { number: string; context: string }[] = []
    const re = /([^.!?\n]{0,60})(\b\d[\d,]*(?:\.\d+)?(?:\s*%|\s*million|\s*billion|\s*thousand)?)\b([^.!?\n]{0,60})/g
    let m: RegExpExecArray | null
    const seen = new Set<string>()
    while ((m = re.exec(content)) !== null) {
      const num = m[2].trim()
      if (seen.has(num)) continue
      seen.add(num)
      matches.push({ number: num, context: `…${(m[1] + m[2] + m[3]).trim()}…` })
    }
    return matches
  })()

  return (
    <div className="max-w-[760px]">

      {/* Metadata fields */}
      <div className="flex flex-col gap-4 mb-6">
        <div>
          <Label htmlFor="edit-title">Title</Label>
          <Input
            id="edit-title"
            value={editTitle}
            onChange={e => setEditTitle(e.target.value)}
            placeholder="Article title"
            className="mt-1 text-lg font-semibold"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="edit-slug">Slug</Label>
            <Input
              id="edit-slug"
              value={editSlug}
              onChange={e => { setEditSlug(e.target.value); setSlugManuallyEdited(true) }}
              placeholder="url-friendly-slug"
              className="mt-1 font-mono text-sm"
            />
          </div>
          <div>
            <Label htmlFor="edit-publisher">Publisher</Label>
            <Input
              id="edit-publisher"
              value={editPublisher}
              onChange={e => setEditPublisher(e.target.value)}
              placeholder="LocReport"
              className="mt-1"
            />
          </div>
        </div>

        <div>
          <Label htmlFor="edit-source-url">Source URL</Label>
          <Input
            id="edit-source-url"
            value={editSourceUrl}
            onChange={e => setEditSourceUrl(e.target.value)}
            placeholder="https://…"
            className="mt-1"
          />
          {editSourceUrl && (
            <a href={editSourceUrl} target="_blank" rel="noopener"
              className="text-xs mt-1 block" style={{ color: 'var(--accent)' }}>
              View source →
            </a>
          )}
        </div>

        <ImageDropzone
          value={editImageUrl}
          onChange={setEditImageUrl}
          hint="Optional. Shown at the top of the published article and as a thumbnail in the lists."
        />

        <div>
          <Label htmlFor="edit-image-alt">Image alt text</Label>
          <Input
            id="edit-image-alt"
            value={editImageAlt}
            onChange={e => setEditImageAlt(e.target.value)}
            placeholder="Describe the image — falls back to the article title"
            className="mt-1"
          />
        </div>

        <div className="flex gap-4">
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--muted)' }}>Impact score (1–5)</label>
            <select
              value={impactScore}
              onChange={e => setImpactScore(e.target.value)}
              className="rounded-md border border-gray-200 px-2 py-1 text-sm"
            >
              <option value="">— AI assigns</option>
              {[1,2,3,4,5].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--muted)' }}>Time horizon</label>
            <select
              value={timeHorizon}
              onChange={e => setTimeHorizon(e.target.value)}
              className="rounded-md border border-gray-200 px-2 py-1 text-sm"
            >
              <option value="">— AI assigns</option>
              <option value="now">Now</option>
              <option value="6months">6 months</option>
              <option value="2years">2 years</option>
            </select>
          </div>
        </div>
      </div>

      {/* Fact Flow — the one headline fact this article publishes alongside itself.
          Reviewed and edited here so it goes out approved, not merely inherited
          from ingest's distillation; Save draft / Approve & publish send it in the
          same request as the article body (see saveDraft/action below). */}
      <div className="mb-6 rounded-lg p-4" style={{ border: '1px solid var(--border)', background: 'var(--surface)' }}>
        <div className="flex items-center justify-between gap-2 mb-1">
          <Label htmlFor="edit-fact" className="mb-0">Fact Flow fact</Label>
          {factPublished && <Badge variant="success">Live on Fact Flow</Badge>}
        </div>
        <p className="text-xs mb-2" style={{ color: 'var(--muted)' }}>
          The single headline sentence this article publishes to <code>/fact-flow</code>. Approving the
          draft publishes this sentence exactly as written here.
          {!factPublished && ' Leave it blank to let the system distil one automatically on approval.'}
        </p>
        <Textarea
          id="edit-fact"
          value={factContent}
          onChange={e => setFactContent(e.target.value)}
          rows={2}
          maxLength={500}
          placeholder="e.g. “DeepL appointed Morten Gram as CFO effective October 2026.”"
          className="text-sm"
        />
        {factPublished ? (
          <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
            Already published — this box can&apos;t be cleared to unpublish it, only edited. Changes save
            with the draft.
          </p>
        ) : !factContent.trim() && (
          <p className="text-xs mt-1" style={{ color: '#92400e' }}>
            No fact parked yet — write one, or approve as is and the system will try to distil one from
            this article automatically. An article is never published without one.
          </p>
        )}
      </div>

      {/* Confabulation guard — flag every number for source cross-check */}
      {suspectNumbers.length > 0 && (
        <div className="mb-4 rounded-lg p-4 text-sm"
          style={{ background: '#fefce8', border: '1px solid #fde68a', color: '#92400e' }}>
          <p className="font-semibold mb-2">Fact-check required: {suspectNumbers.length} number{suspectNumbers.length !== 1 ? 's' : ''} found in this draft</p>
          <p className="mb-3 text-xs" style={{ color: '#78350f' }}>
            AI can fabricate specific figures that never appear in the source. Verify every number below against the original article before approving.
          </p>
          <ul className="space-y-1">
            {suspectNumbers.map(({ number, context }) => (
              <li key={number} className="text-xs font-mono">
                <span className="font-bold">{number}</span>
                <span className="ml-2 opacity-75">{context}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Write / Preview tabs */}
      <div className="flex gap-2 border-b mb-4" style={{ borderColor: 'var(--border)' }}>
        {(['write', 'preview'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className="px-4 py-2 text-sm font-medium capitalize"
            style={tab === t
              ? { borderBottom: '2px solid var(--accent)', color: 'var(--accent)', marginBottom: -1 }
              : { color: 'var(--muted)' }}>
            {t}
          </button>
        ))}
      </div>

      {rerunning ? (
        <div className="py-12 text-center text-sm" style={{ color: 'var(--muted)' }}>
          <div className="mb-3 text-2xl">⟳</div>
          Re-writing the article from the stored facts…
          {rerunInstruction.trim() && (
            <div className="mt-2 text-xs">Applying your extra Stage 2 instruction.</div>
          )}
        </div>
      ) : tab === 'preview' ? (
        <div className="prose" dangerouslySetInnerHTML={{ __html: marked.parse(content) as string }} />
      ) : (
        <textarea
          value={content}
          onChange={e => setContent(e.target.value)}
          rows={24}
          className="w-full font-mono text-sm border rounded-lg p-4 focus:outline-none"
          style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
        />
      )}

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {rerunNote && !rerunning && !error && (
        <p className="mt-4 text-xs" style={{ color: 'var(--muted)' }}>{rerunNote}</p>
      )}

      {confirmRerun && (
        <div className="mt-4 p-4 rounded-lg text-sm"
          style={{ background: '#fefce8', border: '1px solid #fde68a', color: '#92400e' }}>
          <p className="font-semibold mb-1">Re-run this article? The current content will be replaced.</p>
          <p className="mb-4 text-xs" style={{ color: '#78350f' }}>
            {draft.extracted_facts
              ? 'The Stage 1 facts stay exactly as they were extracted — only the Stage 2 write-up is regenerated.'
              : 'This draft has no stored fact sheet yet, so Stage 1 runs once and is pinned to the draft; later re-runs reuse it unchanged.'}
          </p>

          <Label htmlFor="rerun-instruction" style={{ color: '#92400e' }}>
            Extra Stage 2 instruction <span className="font-normal opacity-70">— optional</span>
          </Label>
          <Textarea
            id="rerun-instruction"
            value={rerunInstruction}
            onChange={e => setRerunInstruction(e.target.value)}
            rows={4}
            maxLength={2000}
            placeholder="Leave blank to just re-run as is. Or shape the write-up, e.g. “Lead with the pricing change, cut the analyst quote, keep it under 400 words, more sceptical tone.”"
            className="font-mono text-xs"
          />
          <p className="mt-1 text-xs" style={{ color: '#78350f' }}>
            Applies to this run only. It shapes angle, structure, emphasis and length — it cannot add,
            drop or alter a fact.
          </p>

          <div className="flex gap-2 mt-3 items-center flex-wrap">
            <Button onClick={rerun}>
              {rerunInstruction.trim() ? 'Re-run with instruction' : 'Re-run as is'}
            </Button>
            <Button variant="ghost" onClick={() => setConfirmRerun(false)}>Cancel</Button>
            {rerunInstruction.trim() && (
              <button
                type="button"
                onClick={() => setRerunInstruction('')}
                className="text-xs underline"
                style={{ color: '#92400e' }}
              >
                Clear instruction
              </button>
            )}
          </div>
        </div>
      )}

      <div className="flex gap-3 mt-6 flex-wrap items-center">
        {isPending && !rerunning && (
          <>
            <Button onClick={() => action('approved')} disabled={loading || saving}>Approve & publish</Button>
            <Button variant="danger" onClick={() => action('rejected')} disabled={loading || saving}>Reject</Button>
            <Button variant="secondary" onClick={() => setConfirmRerun(true)} disabled={loading || saving || confirmRerun}>Re-run</Button>
          </>
        )}
        <Button variant="secondary" onClick={saveDraft} disabled={saving || loading || rerunning}>
          {saving ? 'Saving…' : 'Save draft'}
        </Button>
        {savedAt && !saving && (
          <span className="text-xs" style={{ color: 'var(--muted)' }}>
            Saved {savedAt.toLocaleTimeString()}
          </span>
        )}
        <Button variant="ghost" onClick={() => router.back()}>Back</Button>
      </div>
    </div>
  )
}
