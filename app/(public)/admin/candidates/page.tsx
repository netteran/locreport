'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { SourceCandidate, StoryGroup, Composition } from '@/lib/researchTypes'
import { filterCandidates, publisherName } from '@/lib/candidateFilters'
import { ResearchProcessButton } from '@/components/ResearchProcessButton'

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
    [status, setStatus] = useState('available'),
    [publisher, setPublisher] = useState(''),
    [dateFrom, setDateFrom] = useState(''),
    [dateTo, setDateTo] = useState(''),
    [sort, setSort] = useState('published-desc')
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
  const publishers = useMemo(
    () => [...new Set(data.candidates.map(publisherName))].sort((a, b) => a.localeCompare(b)),
    [data.candidates]
  )
  const invalidDates = !!dateFrom && !!dateTo && dateFrom > dateTo
  const visible = useMemo(
    () => filterCandidates(data.candidates, { status, query, publisher, dateFrom, dateTo, sort }),
    [data.candidates, status, query, publisher, dateFrom, dateTo, sort]
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
        Keep useful evidence here until it fits an article. Related sources can contribute to suggested
        articles, including several reports about the same event. Choose 1–8 sources when you are ready.
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
          <ResearchProcessButton label="Find related article suggestions" disabled={busy} onDone={load} />
          <p className="text-xs" style={{ color: 'var(--muted)' }}>Available sources stay in your evidence pool. Event matching does not need to be resolved before choosing sources for an article.</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="text-xs space-y-1">
              <span>Search</span>
              <Input aria-label="Search candidates" value={query}
                onChange={(e) => setQuery(e.target.value)} placeholder="Titles, publishers or topics" />
            </label>
            <label className="text-xs space-y-1">
              <span>Original publisher</span>
              <select className="w-full rounded-lg border px-3 py-2 text-sm" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
                value={publisher} onChange={(e) => setPublisher(e.target.value)}>
                <option value="">All publishers</option>
                {publishers.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            </label>
            <label className="text-xs space-y-1">
              <span>Status</span>
              <select className="w-full rounded-lg border px-3 py-2 text-sm" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
                value={status} onChange={(e) => setStatus(e.target.value)}>
                {['available', 'reserved', 'used', 'dismissed', 'all'].map((s) => <option key={s} value={s}>{s === 'dismissed' ? 'set aside' : s}</option>)}
              </select>
            </label>
            <label className="text-xs space-y-1">
              <span>Published from</span>
              <Input type="date" value={dateFrom} max={dateTo || undefined}
                aria-invalid={invalidDates} onChange={(e) => setDateFrom(e.target.value)} />
            </label>
            <label className="text-xs space-y-1">
              <span>Published through</span>
              <Input type="date" value={dateTo} min={dateFrom || undefined}
                aria-invalid={invalidDates} onChange={(e) => setDateTo(e.target.value)} />
            </label>
            <label className="text-xs space-y-1">
              <span>Sort by</span>
              <select className="w-full rounded-lg border px-3 py-2 text-sm" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
                value={sort} onChange={(e) => setSort(e.target.value)}>
                <option value="published-desc">Published: newest first</option>
                <option value="published-asc">Published: oldest first</option>
                <option value="collected-desc">Recently collected</option>
              </select>
            </label>
          </div>
          {invalidDates && <p role="alert" className="text-sm text-red-600">The start date must be on or before the end date.</p>}
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs" style={{ color: 'var(--muted)' }}>
            <span role="status">{visible.length} of {data.candidates.length} loaded candidates · latest 300 collected · dates use original publication date</span>
            <Button size="xs" variant="ghost" onClick={() => {
              setQuery(''); setPublisher(''); setDateFrom(''); setDateTo(''); setStatus('available'); setSort('published-desc')
            }}>Reset filters</Button>
          </div>
          {selected.length > 0 && (
            <div className="flex gap-3 items-center">
              <span>{selected.length} selected</span>
              <Button
                disabled={busy || selected.length < 1 || selected.length > 8}
                onClick={() => run(() => combine(selected))}
              >
                {selected.length === 1 ? 'Create article' : 'Combine selected'}
              </Button>
              <Button variant="ghost" onClick={() => setSelected([])}>
                Clear
              </Button>
            </div>
          )}
          <div className="overflow-hidden rounded-lg border" style={{ borderColor: 'var(--border)' }}>
            {visible.map((c) => (
              <section
                key={c.id}
                className="border-b last:border-b-0 px-3 py-2"
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
                  <div className="min-w-0 flex-1">
                    <a
                      href={c.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-semibold break-words"
                    >
                      {c.title} ↗
                    </a>
                    <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
                      <span className="font-medium">{publisherName(c)}</span> ·{' '}
                      {c.source_published_at ? <time dateTime={c.source_published_at}>{c.source_published_at.slice(0, 10)}</time> : 'Undated source'}
                      {c.status !== 'available' && ` · ${c.status}`}
                      {c.processing_status !== 'ready' && ` · ${c.processing_status}`}
                    </p>
                  </div>
                </div>

                {c.review_reason?.startsWith('Uncertain') && (
                  <p className="ml-7 mt-1 text-xs" style={{ color: 'var(--muted)' }}>
                    Available for articles · fact publication awaits event matching
                  </p>
                )}
                <details className="ml-7 mt-1">
                  <summary className="text-xs cursor-pointer" style={{ color: 'var(--muted)' }}>Source evidence</summary>
                  <p className="text-xs mt-2">{c.quality} · {c.status} · {c.processing_status}</p>
                  <p className="text-xs mt-1">{c.topics.join(' · ')}</p>
                  <pre className="whitespace-pre-wrap text-xs mt-2">{c.extracted_facts}</pre>
                  <div className="flex gap-2 flex-wrap mt-2">
                    {c.status === 'available' && (
                      <Button
                        size="xs"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => run(() => patch({ id: c.id, status: 'dismissed' }))}
                      >
                        Set aside
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
                  </div>
                  {c.status === 'available' && <p className="text-xs mt-2" style={{ color: 'var(--muted)' }}>Set aside only irrelevant or unusable evidence. It is kept and can be restored from the set-aside filter.</p>}
                </details>
                {(c.review_reason || c.suggested_event_id || c.suggested_fact_id) && (
                  <details className="ml-7 mt-1">
                    <summary className="text-xs cursor-pointer" style={{ color: 'var(--muted)' }}>Fact publication & event matching</summary>
                    <p className="text-xs mt-2">This review concerns standalone facts. Sources remain available for articles while a match is uncertain. Confirming a match keeps the source as supporting evidence; marking a separate event does not publish it.</p>
                    {c.review_reason && <p className="text-xs mt-2">{c.review_reason.startsWith('Uncertain') ? 'The system could not confirm whether this is the same event. Automatic fact publication is on hold.' : c.review_reason}</p>}
                    <div className="flex flex-wrap gap-x-4 gap-y-2 mt-3">
                      {c.suggested_event_id && (
                        <Button
                          size="xs"
                          disabled={busy}
                          onClick={() => run(() => patch({ id: c.id, event_id: c.suggested_event_id }))}
                        >
                          Confirm same event
                        </Button>
                      )}
                      {c.suggested_fact_id && (
                        <Button
                          size="xs"
                          disabled={busy}
                          onClick={() =>
                            run(() => patch({ id: c.id, legacy_fact_id: c.suggested_fact_id }))
                          }
                        >
                          Confirm same published fact
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
                          Mark as separate event
                        </Button>
                      )}
                    </div>
                  </details>
                )}
              </section>
            ))}
            {!visible.length && <p className="p-4 text-sm">No matching source candidates. Try changing or resetting the filters.</p>}
          </div>
        </>
      )}
      {tab === 'groups' && (
        <>
          <ResearchProcessButton label="Refresh suggestions" disabled={busy} onDone={load} />
          <p className="text-sm" style={{ color: 'var(--muted)' }}>Suggestions connect evidence around an editorial question. Same-event reports can add detail; related developments can support a broader analysis. Refresh checks up to 60 of the latest available, processed sources, with no age cutoff.</p>
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
