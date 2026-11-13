'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { SourceCandidate, StoryGroup, Composition } from '@/lib/researchTypes'

type Event = { id: string; headline: string; stage: string; review_required: boolean }
export default function CandidatesPage() {
  const router = useRouter()
  const [data, setData] = useState<{
    candidates: SourceCandidate[]
    groups: StoryGroup[]
    events: Event[]
    compositions: Composition[]
  }>({ candidates: [], groups: [], events: [], compositions: [] })
  const [tab, setTab] = useState('candidates'),
    [query, setQuery] = useState(''),
    [status, setStatus] = useState('available')
  const [selected, setSelected] = useState<string[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const [mergeFrom, setMergeFrom] = useState(''),
    [mergeInto, setMergeInto] = useState('')
  const load = useCallback(async () => {
    const r = await fetch('/api/candidates')
    const d = await r.json()
    if (!r.ok) throw new Error(d.error || 'Could not load candidates')
    setData(d)
  }, [])
  useEffect(() => {
    load().catch((e) => setError(String(e)))
  }, [load])
  const visible = useMemo(
    () =>
      data.candidates.filter(
        (c) =>
          (status === 'all' || c.status === status) &&
          `${c.title} ${c.source_name} ${c.topics.join(' ')} ${c.entities.join(' ')}`
            .toLowerCase()
            .includes(query.toLowerCase())
      ),
    [data.candidates, status, query]
  )
  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }
  async function patch(body: unknown) {
    const r = await fetch('/api/candidates', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    if (!r.ok) throw new Error((await r.json()).error)
    await load()
  }
  async function combine(ids: string[], title = '', angle = '') {
    const r = await fetch('/api/compositions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ candidate_ids: ids, title, angle })
    })
    const d = await r.json()
    if (!r.ok) throw new Error(d.error)
    router.push(`/admin/candidates/compositions/${d.id}`)
  }
  return (
    <div className="max-w-[1000px] space-y-5">
      <h1 className="text-2xl font-bold">Source candidates</h1>
      <p className="text-sm" style={{ color: 'var(--muted)' }}>
        Collected evidence for your next article. Choose 2–8 sources, add your direction, then
        generate a draft when you are ready.
      </p>
      <div className="flex gap-2 flex-wrap">
        {[
          ['candidates', 'Candidates'],
          ['groups', 'Suggested articles'],
          ['compositions', 'Compositions'],
          ['events', 'Event review']
        ].map(([key, label]) => (
          <Button
            key={key}
            variant={tab === key ? 'primary' : 'secondary'}
            onClick={() => setTab(key)}
          >
            {label}
          </Button>
        ))}
      </div>
      {error && (
        <p role="alert" className="text-red-600 text-sm">
          {error}
        </p>
      )}
      {tab === 'candidates' && (
        <>
          <div className="flex gap-3 flex-wrap">
            <Input
              aria-label="Search candidates"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search titles, sources or topics"
            />
            <select
              aria-label="Candidate status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              {['available', 'reserved', 'used', 'dismissed', 'all'].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </div>
          {selected.length > 0 && (
            <div className="flex gap-3 items-center">
              <span>{selected.length} selected</span>
              <Button
                disabled={busy || selected.length < 2 || selected.length > 8}
                onClick={() => run(() => combine(selected))}
              >
                Combine selected
              </Button>
              <Button variant="ghost" onClick={() => setSelected([])}>
                Clear
              </Button>
            </div>
          )}
          {visible.map((c) => (
            <section
              key={c.id}
              className="border rounded-lg p-4 space-y-2"
              style={{ borderColor: 'var(--border)' }}
            >
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  aria-label={`Select ${c.title}`}
                  checked={selected.includes(c.id)}
                  disabled={c.status !== 'available'}
                  onChange={(e) =>
                    setSelected((s) =>
                      e.target.checked ? [...s, c.id] : s.filter((id) => id !== c.id)
                    )
                  }
                />
                <div className="flex-1">
                  <a
                    href={c.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold"
                  >
                    {c.title} ↗
                  </a>
                  <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
                    {c.source_name} · {c.source_published_at?.slice(0, 10) || 'Undated source'} ·{' '}
                    {c.quality} · {c.status} · {c.processing_status}
                  </p>
                </div>
              </div>
              <p className="text-xs">{c.topics.join(' · ')}</p>
              {c.review_reason && (
                <p className="text-sm" style={{ color: 'var(--gold,#92400e)' }}>
                  {c.review_reason}
                </p>
              )}
              <details>
                <summary className="text-sm cursor-pointer">Source evidence</summary>
                <pre className="whitespace-pre-wrap text-xs mt-2">{c.extracted_facts}</pre>
              </details>
              <div className="flex gap-2 flex-wrap">
                {c.status === 'available' && (
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => run(() => patch({ id: c.id, status: 'dismissed' }))}
                  >
                    Dismiss
                  </Button>
                )}
                {c.status === 'used' && (
                  <Button
                    size="xs"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => run(() => patch({ id: c.id, status: 'available' }))}
                  >
                    Reuse in another article
                  </Button>
                )}
                {c.status === 'dismissed' && (
                  <Button
                    size="xs"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => run(() => patch({ id: c.id, status: 'available' }))}
                  >
                    Restore
                  </Button>
                )}
                {c.reserved_by && (
                  <Link
                    href={`/admin/candidates/compositions/${c.reserved_by}`}
                    className="text-sm underline"
                  >
                    Open composition
                  </Link>
                )}
                {c.suggested_event_id && (
                  <Button
                    size="xs"
                    disabled={busy}
                    onClick={() => run(() => patch({ id: c.id, event_id: c.suggested_event_id }))}
                  >
                    Confirm same event
                  </Button>
                )}
                {c.review_reason?.startsWith('Conflicting') && c.event_id && (
                  <Button
                    size="xs"
                    disabled={busy}
                    onClick={() => run(() => patch({ id: c.id, event_id: c.event_id }))}
                  >
                    Confirm evidence after review
                  </Button>
                )}
                {c.review_reason?.startsWith('Uncertain') && (
                  <Button
                    size="xs"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => run(() => patch({ id: c.id, new_event: true }))}
                  >
                    Treat as a distinct event
                  </Button>
                )}
              </div>
            </section>
          ))}
          {!visible.length && <p>No matching source candidates.</p>}
        </>
      )}
      {tab === 'groups' && (
        <>
          <Button
            disabled={busy}
            variant="secondary"
            onClick={() =>
              run(async () => {
                const r = await fetch('/api/research/process', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ stage: 'groups' })
                })
                if (!r.ok) throw new Error((await r.json()).error)
                await load()
              })
            }
          >
            Refresh suggestions
          </Button>
          {data.groups.map((g) => {
            const candidates = g.candidate_ids
              .map((id) => data.candidates.find((c) => c.id === id))
              .filter((c): c is SourceCandidate => !!c && c.status === 'available')
            return (
              candidates.length >= 2 && (
                <section
                  key={g.id}
                  className="border rounded-lg p-4 space-y-3"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <h2 className="font-semibold">{g.title}</h2>
                  <p>{g.question}</p>
                  <p className="text-sm" style={{ color: 'var(--muted)' }}>
                    {g.rationale}
                  </p>
                  <ul className="text-sm space-y-1">
                    {candidates.map((c) => (
                      <li key={c.id}>
                        {c.title} · {c.source_name}
                      </li>
                    ))}
                  </ul>
                  <div className="flex gap-2">
                    <Button
                      disabled={busy}
                      onClick={() =>
                        run(() =>
                          combine(
                            candidates.map((c) => c.id),
                            g.title,
                            g.question
                          )
                        )
                      }
                    >
                      Choose sources & direction
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() => run(() => patch({ group_id: g.id }))}
                    >
                      Dismiss suggestion
                    </Button>
                  </div>
                </section>
              )
            )
          })}
          {!data.groups.length && (
            <p>Suggestions appear when collected evidence supports a common editorial question.</p>
          )}
        </>
      )}
      {tab === 'compositions' &&
        data.compositions.map((c) => (
          <div key={c.id} className="border-b py-3">
            <Link
              className="font-semibold underline"
              href={`/admin/candidates/compositions/${c.id}`}
            >
              {c.title || 'Untitled composition'}
            </Link>
            <span className="ml-3 text-sm">{c.status}</span>
            {c.draft_id && (
              <Link className="ml-3 text-sm underline" href={`/admin/drafts/${c.draft_id}`}>
                Review draft
              </Link>
            )}
            {c.last_error && (
              <p role="alert" className="text-sm text-red-600">
                {c.last_error}
              </p>
            )}
          </div>
        ))}
      {tab === 'events' && (
        <>
          <p className="text-sm">
            Merge duplicate events after checking their evidence. Different transaction stages
            should remain separate.
          </p>
          <div className="flex gap-2 flex-wrap">
            <select
              aria-label="Duplicate event"
              value={mergeFrom}
              onChange={(e) => setMergeFrom(e.target.value)}
            >
              <option value="">Duplicate event…</option>
              {data.events.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.headline}
                </option>
              ))}
            </select>
            <select
              aria-label="Retain event"
              value={mergeInto}
              onChange={(e) => setMergeInto(e.target.value)}
            >
              <option value="">Event to retain…</option>
              {data.events.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.headline}
                </option>
              ))}
            </select>
            <Button
              disabled={busy || !mergeFrom || !mergeInto || mergeFrom === mergeInto}
              onClick={() => run(() => patch({ merge_from: mergeFrom, merge_into: mergeInto }))}
            >
              Merge events
            </Button>
          </div>
          {data.events.map((e) => (
            <div className="border-b py-3" key={e.id}>
              <p>{e.headline}</p>
              <span className="text-xs">
                {e.stage}
                {e.review_required ? ' · Conflicting evidence — review required' : ''}
              </span>
            </div>
          ))}
        </>
      )}
    </div>
  )
}
