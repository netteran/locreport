'use client'
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { RssSource } from '@/lib/types'
import { SourceForm } from '@/components/SourceForm'
import { IngestButton } from '@/components/IngestButton'
import { PodcastEpisodes, postJson } from '@/components/PodcastEpisodes'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

const BATCH_SIZE = 3
const FIELD = 'px-2 py-0.5 text-xs rounded-md'

type SourceWithStats = RssSource & { recent_drafts: number }
type Row = SourceWithStats & { batch: number | null }
type Panel = { id: string; kind: 'edit' | 'episodes' } | null
type SortKey = 'batch' | 'name' | 'type' | 'keywords' | 'drafts' | 'auto'
type Sort = { key: SortKey; dir: 1 | -1 } | null

// Sort values per column. Rows without a value (no batch, no keywords) always
// sink to the bottom whichever way the column is sorted.
function sortValue(r: Row, key: SortKey): string | number | null {
  switch (key) {
    case 'batch': return r.batch
    case 'name': return r.name.toLowerCase()
    case 'type': return r.kind === 'podcast' ? 'podcast' : 'feed'
    case 'keywords': return r.kind === 'podcast' ? (r.podcast_config?.ignore_before ?? null) : ((r.keywords ?? []).join(', ').toLowerCase() || null)
    case 'drafts': return r.recent_drafts
    case 'auto': return r.auto_publish ? 1 : 0
  }
}

const selectStyle = { background: 'var(--surface, var(--bg))', color: 'var(--text)', borderColor: 'var(--border)' }

export default function SourcesPage() {
  const [sources, setSources] = useState<SourceWithStats[]>([])
  const [adding, setAdding] = useState(false)
  const [panel, setPanel] = useState<Panel>(null)
  const [q, setQ] = useState('')
  const [type, setType] = useState<'all' | 'feed' | 'podcast'>('all')
  const [status, setStatus] = useState<'active' | 'disabled' | 'all'>('active')
  const [auto, setAuto] = useState<'all' | 'on' | 'off'>('all')
  const [batch, setBatch] = useState<'all' | string>('all')
  // null = the API's order (oldest first), which is also batch order.
  const [sort, setSort] = useState<Sort>(null)

  const load = useCallback(() => {
    fetch('/api/sources').then(r => r.json()).then(setSources)
  }, [])
  useEffect(() => { load() }, [load])

  // Active news feeds are grouped into ingest batches of BATCH_SIZE in the order
  // they were added (the API returns them oldest first). Podcasts and disabled
  // sources belong to no batch.
  const rows: Row[] = useMemo(() => {
    let n = 0
    return sources.map(s => {
      const inBatch = s.active && s.kind !== 'podcast'
      const row = { ...s, batch: inBatch ? Math.floor(n / BATCH_SIZE) + 1 : null }
      if (inBatch) n++
      return row
    })
  }, [sources])
  const batchCount = Math.max(0, ...rows.map(r => r.batch ?? 0))

  const filtered = rows.filter(r => {
    const isPodcast = r.kind === 'podcast'
    if (type !== 'all' && (type === 'podcast') !== isPodcast) return false
    if (status !== 'all' && (status === 'active') !== r.active) return false
    if (auto !== 'all' && (auto === 'on') !== !!r.auto_publish) return false
    if (batch !== 'all' && String(r.batch) !== batch) return false
    if (q) {
      const hay = `${r.name} ${r.url} ${(r.keywords ?? []).join(' ')}`.toLowerCase()
      if (!hay.includes(q.toLowerCase())) return false
    }
    return true
  })
  const visible = !sort ? filtered : [...filtered].sort((a, b) => {
    const va = sortValue(a, sort.key)
    const vb = sortValue(b, sort.key)
    if (va === null && vb === null) return 0
    if (va === null) return 1
    if (vb === null) return -1
    const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb))
    return cmp * sort.dir || a.name.localeCompare(b.name)
  })

  // Click cycles a column: ascending → descending → back to the default order.
  function sortBy(key: SortKey) {
    setSort(s => (!s || s.key !== key ? { key, dir: 1 } : s.dir === 1 ? { key, dir: -1 } : null))
  }
  function SortTh({ k, label, className, title }: { k: SortKey; label: string; className?: string; title?: string }) {
    const active = sort?.key === k
    return (
      <th className={`px-2 py-0.5 font-medium ${className ?? ''}`} title={title} aria-sort={active ? (sort!.dir === 1 ? 'ascending' : 'descending') : 'none'}>
        <button type="button" onClick={() => sortBy(k)} className="inline-flex items-center gap-0.5 hover:underline" style={{ color: active ? 'var(--text)' : 'inherit' }}>
          {label}<span style={{ opacity: active ? 1 : 0.35 }}>{active ? (sort!.dir === 1 ? '▲' : '▼') : '↕'}</span>
        </button>
      </th>
    )
  }

  async function patch(id: string, body: Record<string, unknown>) {
    const res = await fetch(`/api/sources/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) alert((await res.json().catch(() => ({}))).error ?? 'Update failed')
    load()
  }

  async function toggleAuto(r: Row) {
    if (r.kind === 'podcast' && !r.auto_publish) {
      const cfg = r.podcast_config
      if (!cfg) return alert('This podcast has no config yet — Edit it first.')
      const baseline = cfg.ignore_before
      const msg = baseline
        ? `Auto for "${r.name}": on each scheduled ingest run, new full episodes published after ${baseline.slice(0, 16).replace('T', ' ')} are generated with Gemini and published automatically. Continue?`
        : `Auto for "${r.name}": everything published up to now will be marked as seen, and each new full episode after this moment will be generated with Gemini and published automatically on the scheduled ingest runs. Continue?`
      if (!confirm(msg)) return
      // Baseline "now" if none is set, so enabling Auto can never sweep the back catalogue.
      return patch(r.id, baseline
        ? { auto_publish: true }
        : { auto_publish: true, podcast_config: { ...cfg, ignore_before: new Date().toISOString().slice(0, 19) + 'Z' } })
    }
    return patch(r.id, { auto_publish: !r.auto_publish })
  }

  async function remove(r: Row) {
    if (!confirm(`Delete "${r.name}" permanently?\n\nIts URL, keywords and settings are removed. Drafts and articles it produced stay, but lose their link to this source (the 30d count, and for podcasts the podcast-style Re-run on pending drafts).\n\nTo just stop ingesting it, use Disable instead.`)) return
    await fetch(`/api/sources/${r.id}`, { method: 'DELETE' })
    load()
  }

  const counts = {
    feeds: rows.filter(r => r.active && r.kind !== 'podcast').length,
    podcasts: rows.filter(r => r.active && r.kind === 'podcast').length,
    disabled: rows.filter(r => !r.active).length,
  }

  return (
    <div className="text-xs">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <h1 className="font-bold" style={{ color: 'var(--text)', fontSize: '1.125rem', lineHeight: 1.2, margin: 0 }}>Sources</h1>
        <span style={{ color: 'var(--muted)' }}>
          {counts.feeds} feeds · {batchCount} batch{batchCount !== 1 ? 'es' : ''} · {counts.podcasts} podcast{counts.podcasts !== 1 ? 's' : ''} · {counts.disabled} disabled
        </span>
        <Button size="xs" className="ml-auto" variant={adding ? 'ghost' : 'primary'} onClick={() => setAdding(a => !a)}>
          {adding ? '− Close' : '+ Add'}
        </Button>
      </div>

      {adding && (
        <div className="mb-2 rounded-md p-2" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
          <SourceForm onAdded={() => { setAdding(false); load() }} onCancel={() => setAdding(false)} />
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-1 mb-1 flex-wrap">
        <Input className={FIELD} style={{ width: '14rem', padding: '2px 8px' }} placeholder="Filter name, URL, keyword…" value={q} onChange={e => setQ(e.target.value)} />
        <select aria-label="Type" className={`${FIELD} border`} style={selectStyle} value={type} onChange={e => setType(e.target.value as typeof type)}>
          <option value="all">All types</option>
          <option value="feed">Feeds</option>
          <option value="podcast">Podcasts</option>
        </select>
        <select aria-label="Status" className={`${FIELD} border`} style={selectStyle} value={status} onChange={e => setStatus(e.target.value as typeof status)}>
          <option value="active">Active</option>
          <option value="disabled">Disabled</option>
          <option value="all">Any status</option>
        </select>
        <select aria-label="Auto" className={`${FIELD} border`} style={selectStyle} value={auto} onChange={e => setAuto(e.target.value as typeof auto)}>
          <option value="all">Auto: any</option>
          <option value="on">Auto: on</option>
          <option value="off">Auto: off</option>
        </select>
        <select aria-label="Batch" className={`${FIELD} border`} style={selectStyle} value={batch} onChange={e => setBatch(e.target.value)}>
          <option value="all">All batches</option>
          {Array.from({ length: batchCount }, (_, i) => <option key={i} value={String(i + 1)}>Batch {i + 1}</option>)}
        </select>
        {batch !== 'all' && (
          <IngestButton
            compact
            label={`Ingest batch ${batch}`}
            sourceIds={rows.filter(r => String(r.batch) === batch).map(r => r.id)}
            onDone={load}
          />
        )}
        <span className="ml-auto" style={{ color: 'var(--muted)' }}>{visible.length} shown</span>
      </div>

      <div className="overflow-x-auto rounded-md" style={{ border: '1px solid var(--border)' }}>
        <table className="w-full border-collapse">
          <thead>
            <tr style={{ background: 'var(--bg-secondary)', color: 'var(--muted)' }} className="text-left">
              <SortTh k="batch" label="Batch" className="w-10" />
              <SortTh k="name" label="Source" />
              <SortTh k="type" label="Type" className="w-16" />
              <SortTh k="keywords" label="Keywords" className="hidden md:table-cell" />
              <SortTh k="drafts" label="30d" className="w-10 text-right" title="Drafts in the last 30 days" />
              <SortTh k="auto" label="Auto" className="w-10 text-center" title="Feeds: drafts are approved automatically. Podcasts: new full episodes after the baseline are generated and published on the scheduled runs." />
              <th className="px-2 py-0.5 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {visible.map(r => {
              const isPodcast = r.kind === 'podcast'
              const open = panel?.id === r.id ? panel.kind : null
              return (
                <Fragment key={r.id}>
                  <tr style={{ borderTop: '1px solid var(--hairline, var(--border))', opacity: r.active ? 1 : 0.55 }}>
                    <td className="px-2 py-0.5 font-mono" style={{ color: 'var(--accent)' }}>{r.batch ?? '—'}</td>
                    <td className="px-2 py-0.5 max-w-0 w-full">
                      <div className="truncate" title={`${r.name}\n${r.url}`}>
                        <span className="font-medium" style={{ color: 'var(--text)' }}>{r.name}</span>
                        <span style={{ color: 'var(--muted)' }}> · {r.url.replace(/^https?:\/\/(www\.)?/, '')}</span>
                      </div>
                    </td>
                    <td className="px-2 py-0.5" style={{ color: 'var(--muted)' }}>{isPodcast ? 'podcast' : 'feed'}</td>
                    <td className="px-2 py-0.5 hidden md:table-cell max-w-[14rem] truncate" style={{ color: 'var(--muted)' }} title={(r.keywords ?? []).join(', ')}>
                      {isPodcast
                        ? (r.podcast_config?.ignore_before ? `new after ${r.podcast_config.ignore_before.slice(0, 10)}` : 'no baseline')
                        : (r.keywords ?? []).join(', ')}
                    </td>
                    <td className="px-2 py-0.5 text-right">
                      {r.recent_drafts > 0
                        ? <Link href="/admin/drafts" style={{ color: 'var(--accent)' }}>{r.recent_drafts}</Link>
                        : <span style={{ color: 'var(--muted)' }}>0</span>}
                    </td>
                    <td className="px-2 py-0.5 text-center">
                      <input
                        type="checkbox"
                        checked={!!r.auto_publish}
                        disabled={!r.active}
                        onChange={() => toggleAuto(r)}
                        className="h-3.5 w-3.5 cursor-pointer align-middle"
                        style={{ accentColor: 'var(--accent)' }}
                        aria-label={`Auto for ${r.name}`}
                        title={isPodcast
                          ? 'New full episodes after the baseline are generated and published automatically on the scheduled ingest runs'
                          : 'Drafts from this source are approved automatically, without human review'}
                      />
                    </td>
                    <td className="px-2 py-0.5 whitespace-nowrap">
                      <div className="flex gap-1 justify-end items-center">
                        {r.active && !isPodcast && <IngestButton compact label="Ingest" sourceIds={[r.id]} onDone={load} />}
                        {r.active && isPodcast && <PodcastRunButton id={r.id} autoPublish={!!r.auto_publish} onDone={load} />}
                        {r.active && isPodcast && (
                          <Button size="xs" variant={open === 'episodes' ? 'primary' : 'secondary'} onClick={() => setPanel(open === 'episodes' ? null : { id: r.id, kind: 'episodes' })}>
                            Episodes
                          </Button>
                        )}
                        <Button size="xs" variant={open === 'edit' ? 'primary' : 'secondary'} onClick={() => setPanel(open === 'edit' ? null : { id: r.id, kind: 'edit' })}>Edit</Button>
                        <Button size="xs" variant="secondary" title={r.active ? 'Pause: keep the source and its settings, stop ingesting it. Re-enable any time.' : 'Resume ingesting this source'} onClick={() => patch(r.id, { active: !r.active })}>{r.active ? 'Disable' : 'Enable'}</Button>
                        <Button size="xs" variant="danger" onClick={() => remove(r)} aria-label={`Delete ${r.name}`} title="Delete permanently (settings are lost; its drafts and articles stay but lose their link to this source)">×</Button>
                      </div>
                    </td>
                  </tr>
                  {open && (
                    <tr style={{ background: 'var(--bg-secondary)' }}>
                      <td />
                      <td colSpan={6} className="px-2 py-0.5.5">
                        {open === 'edit'
                          ? <EditRow row={r} onSaved={() => { setPanel(null); load() }} onCancel={() => setPanel(null)} />
                          : <PodcastEpisodes sourceId={r.id} />}
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
            {visible.length === 0 && (
              <tr><td colSpan={7} className="px-2 py-3 text-center" style={{ color: 'var(--muted)' }}>No sources match the filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-2" style={{ color: 'var(--muted)' }}>
        Active news feeds are grouped into batches of {BATCH_SIZE} in the order they were added; pick a batch in the filter to ingest it on its own.
        Scheduled ingest runs on workdays at 10:00, 13:00 and 17:00 Warsaw time and also handles podcasts with Auto ticked.
      </p>
    </div>
  )
}

function EditRow({ row, onSaved, onCancel }: { row: Row; onSaved: () => void; onCancel: () => void }) {
  const isPodcast = row.kind === 'podcast'
  const [name, setName] = useState(row.name)
  const [url, setUrl] = useState(row.url)
  const [keywords, setKeywords] = useState((row.keywords ?? []).join(', '))
  const [config, setConfig] = useState(JSON.stringify(row.podcast_config ?? {}, null, 2))
  const [error, setError] = useState('')

  async function save() {
    const body: Record<string, unknown> = { name, url }
    if (isPodcast) {
      try {
        body.podcast_config = JSON.parse(config)
      } catch {
        return setError('Config is not valid JSON')
      }
    } else {
      body.keywords = keywords.split(',').map(k => k.trim().toLowerCase()).filter(Boolean)
    }
    const res = await fetch(`/api/sources/${row.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) return setError((await res.json().catch(() => ({}))).error ?? 'Save failed')
    onSaved()
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="grid gap-1 sm:grid-cols-[14rem_1fr]">
        <Input className={FIELD} value={name} onChange={e => setName(e.target.value)} placeholder="Name" />
        <Input className={FIELD} value={url} onChange={e => setUrl(e.target.value)} placeholder="URL" />
      </div>
      {isPodcast
        ? <Textarea className={`${FIELD} font-mono`} rows={12} value={config} onChange={e => setConfig(e.target.value)} />
        : <Input className={FIELD} value={keywords} onChange={e => setKeywords(e.target.value)} placeholder="Keywords (comma-separated)" />}
      {isPodcast && (
        <p style={{ color: 'var(--muted)' }}>
          Links the writer may use (others are stripped) · <code>model</code>: Gemini model id · <code>ignore_before</code>: episodes up to this moment count as seen.
        </p>
      )}
      {error && <p className="text-red-600">{error}</p>}
      <div className="flex gap-1">
        <Button size="xs" onClick={save}>Save</Button>
        <Button size="xs" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  )
}

// A podcast row's "Ingest": runs the same one-step-at-a-time automatic runner
// the schedule uses, for this source only, until it reports idle. Publishes
// only when the source has Auto ticked; otherwise the results wait in drafts.
function PodcastRunButton({ id, autoPublish, onDone }: { id: string; autoPublish: boolean; onDone: () => void }) {
  const [state, setState] = useState<'idle' | 'confirm' | 'running'>('idle')
  const [note, setNote] = useState('')

  async function run() {
    setState('running')
    let made = 0
    let published = 0
    try {
      for (let i = 0; i < 8; i++) {
        setNote(i === 0 ? 'checking…' : `step ${i + 1}…`)
        const res = await postJson(`/api/podcasts/auto?id=${id}`, {})
        if (res.action === 'idle') break
        if (res.action === 'error') throw new Error(String(res.error))
        if (res.action === 'written') {
          made++
          if (res.published) published++
        }
      }
      setNote(made === 0 ? 'no new episodes' : `${made} written${published ? `, ${published} published` : ' → drafts'}`)
      onDone()
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'failed')
    } finally {
      setState('idle')
    }
  }

  if (state === 'confirm') {
    return (
      <span className="flex items-center gap-1">
        <span style={{ color: 'var(--muted)' }}>{autoPublish ? 'Generate + publish new?' : 'Generate new → drafts?'}</span>
        <Button size="xs" onClick={run}>Yes</Button>
        <Button size="xs" variant="ghost" onClick={() => setState('idle')}>No</Button>
      </span>
    )
  }
  return (
    <span className="flex items-center gap-1">
      {note && <span className={state === 'running' ? 'animate-pulse' : ''} style={{ color: 'var(--muted)' }}>{note}</span>}
      <Button size="xs" variant="secondary" disabled={state === 'running'} onClick={() => setState('confirm')}>Ingest</Button>
    </span>
  )
}
