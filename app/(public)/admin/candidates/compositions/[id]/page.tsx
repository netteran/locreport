'use client'
import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { Composition, SourceCandidate } from '@/lib/researchTypes'

export default function CompositionPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [composition, setComposition] = useState<Composition | null>(null),
    [available, setAvailable] = useState<SourceCandidate[]>([])
  const [ids, setIds] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [saved, setSaved] = useState(false)
  const load = useCallback(async () => {
    const [r, all] = await Promise.all([fetch(`/api/compositions/${id}`), fetch('/api/candidates')])
    const d = await r.json()
    if (!r.ok) throw new Error(d.error)
    setComposition(d)
    setIds(d.composition_sources.map((s: { candidate_id: string }) => s.candidate_id))
    const a = await all.json()
    if (all.ok) setAvailable(a.candidates)
  }, [id])
  useEffect(() => {
    load().catch((e) => setError(String(e)))
  }, [load])
  function field<K extends keyof Composition>(key: K, value: Composition[K]) {
    setComposition((c) => (c ? { ...c, [key]: value } : c))
    setSaved(false)
  }
  async function save() {
    if (!composition) return
    const r = await fetch(`/api/compositions/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: composition.title,
        angle: composition.angle,
        personal_experience: composition.personal_experience,
        target_words: composition.target_words,
        candidate_ids: ids
      })
    })
    if (!r.ok) throw new Error((await r.json()).error)
    setSaved(true)
  }
  async function action(fn: () => Promise<void>) {
    setBusy(true)
    setError('')
    try {
      await fn()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }
  const locked =
    busy || (!!composition && ['generating', 'published', 'abandoned'].includes(composition.status))
  return (
    <div className="max-w-[900px] space-y-5">
      <Link href="/admin/candidates" className="text-sm underline">
        ← Source candidates
      </Link>
      <h1 className="text-2xl font-bold">Combine sources</h1>
      {error && (
        <p role="alert" className="text-red-600">
          {error}
        </p>
      )}
      {composition && (
        <>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            Select the evidence and shape the argument. Generation saves a pending draft for your
            review.
          </p>
          <label className="block">
            Working title
            <Input
              value={composition.title}
              maxLength={250}
              disabled={locked}
              onChange={(e) => field('title', e.target.value)}
            />
          </label>
          <label className="block">
            Central question and editorial direction
            <Textarea
              value={composition.angle}
              maxLength={12000}
              rows={4}
              disabled={locked}
              onChange={(e) => field('angle', e.target.value)}
              placeholder="Who is this for? What should it explain, compare or challenge?"
            />
          </label>
          <label className="block">
            Your personal experience
            <Textarea
              value={composition.personal_experience}
              maxLength={12000}
              rows={5}
              disabled={locked}
              onChange={(e) => field('personal_experience', e.target.value)}
              placeholder="Add concrete observations, examples or lessons you want incorporated. Leave empty for no first-person experience."
            />
          </label>
          <label className="block">
            Target words
            <Input
              type="number"
              min={600}
              max={2400}
              step={100}
              value={composition.target_words}
              disabled={locked}
              onChange={(e) => field('target_words', Number(e.target.value))}
            />
          </label>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            Recommended: 1,200–1,600 words. This is a soft target; the evidence determines the
            useful length.
          </p>
          <h2 className="font-semibold">Selected sources ({ids.length}/8)</h2>
          {ids.map((sourceId, index) => {
            const s =
              composition.composition_sources?.find((s) => s.candidate_id === sourceId)?.snapshot ||
              available.find((c) => c.id === sourceId)
            return (
              s && (
                <section
                  className="border rounded-lg p-3 space-y-2"
                  key={sourceId}
                  style={{ borderColor: 'var(--border)' }}
                >
                  <a
                    href={s.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium"
                  >
                    {s.title} ↗
                  </a>
                  <p className="text-xs">
                    {s.source_name} · {s.source_published_at?.slice(0, 10) || 'Undated'} ·{' '}
                    {s.quality}
                  </p>
                  <details>
                    <summary className="cursor-pointer text-sm">Evidence snapshot</summary>
                    <pre className="whitespace-pre-wrap text-xs mt-2">{s.extracted_facts}</pre>
                  </details>
                  <div className="flex gap-2">
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={locked}
                      onClick={() => {
                        setIds((v) => v.filter((x) => x !== sourceId))
                        setSaved(false)
                      }}
                    >
                      Remove
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={locked || index === 0}
                      onClick={() =>
                        setIds((v) => {
                          const n = [...v]
                          ;[n[index - 1], n[index]] = [n[index], n[index - 1]]
                          return n
                        })
                      }
                    >
                      Move up
                    </Button>
                  </div>
                </section>
              )
            )
          })}
          <label className="block">
            Add another source
            <select
              className="block w-full border rounded p-2"
              value=""
              disabled={locked || ids.length >= 8}
              onChange={(e) => {
                setIds((v) => [...v, e.target.value])
                setSaved(false)
              }}
            >
              <option value="">Choose available source…</option>
              {available
                .filter((c) => c.status === 'available' && !ids.includes(c.id))
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
            </select>
          </label>
          {composition.last_error && (
            <p className="text-red-600 text-sm">Last generation: {composition.last_error}</p>
          )}
          <div className="flex gap-3 flex-wrap items-center">
            <Button
              variant="secondary"
              disabled={locked || ids.length < 2}
              onClick={() => action(save)}
            >
              Save brief
            </Button>
            <Button
              disabled={locked || ids.length < 2 || !composition.angle.trim()}
              onClick={() =>
                action(async () => {
                  await save()
                  const r = await fetch(`/api/compositions/${id}/generate`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ request_id: crypto.randomUUID() })
                  })
                  const d = await r.json()
                  if (!r.ok) {
                    await load()
                    throw new Error(d.error)
                  }
                  router.push(`/admin/drafts/${d.draft_id}`)
                })
              }
            >
              {busy ? 'Working…' : composition.draft_id ? 'Regenerate draft' : 'Generate draft'}
            </Button>
            {composition.status === 'generating' && (
              <>
                <p className="text-sm">
                  Generation is still running or was interrupted. You can check the saved request;
                  an interrupted request can retry after ten minutes.
                </p>
                <Button
                  disabled={busy}
                  variant="secondary"
                  onClick={() =>
                    action(async () => {
                      const r = await fetch(`/api/compositions/${id}/generate`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          request_id: composition.generation_request_id || crypto.randomUUID()
                        })
                      })
                      const d = await r.json()
                      if (!r.ok) {
                        await load()
                        throw new Error(d.error)
                      }
                      router.push(`/admin/drafts/${d.draft_id}`)
                    })
                  }
                >
                  Check or retry saved generation
                </Button>
              </>
            )}
            {composition.draft_id && (
              <Link href={`/admin/drafts/${composition.draft_id}`} className="underline text-sm">
                Review saved draft
              </Link>
            )}
            {saved && <span className="text-sm">Brief saved</span>}
            <Button
              variant="ghost"
              disabled={locked}
              onClick={() =>
                action(async () => {
                  const r = await fetch(`/api/compositions/${id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ status: 'abandoned' })
                  })
                  if (!r.ok) throw new Error((await r.json()).error)
                  router.push('/admin/candidates')
                })
              }
            >
              Abandon & release sources
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
