'use client'
import { useEffect, useMemo, useState, useCallback } from 'react'
import { RssSource } from '@/lib/types'
import { SourceForm } from '@/components/SourceForm'
import { IngestButton } from '@/components/IngestButton'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const BATCH_SIZE = 3

type SourceWithStats = RssSource & { recent_drafts: number }
type SourceRow = SourceWithStats & { batchNumber: number | null }

type DraftsFilter = 'any' | 'has' | 'none'
type AutoPublishFilter = 'all' | 'auto' | 'manual'

const DEFAULT_FILTERS = {
  source: '',
  keywords: '',
  batch: 'all' as string, // 'all' | 'disabled' | '1' | '2' | ...
  drafts: 'any' as DraftsFilter,
  autoPublish: 'all' as AutoPublishFilter,
}

function groupIntoBatches<T>(arr: T[], size: number): T[][] {
  const batches: T[][] = []
  for (let i = 0; i < arr.length; i += size) batches.push(arr.slice(i, i + size))
  return batches
}

const filterInputClass = 'w-full rounded border px-2 py-1 text-xs focus:outline-none focus:ring-1'
const filterInputStyle = {
  background: 'var(--surface)',
  borderColor: 'var(--border)',
  color: 'var(--text)',
  '--tw-ring-color': 'var(--accent-soft)',
} as React.CSSProperties

export default function SourcesPage() {
  const [sources, setSources] = useState<SourceWithStats[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editUrl, setEditUrl] = useState('')
  const [editKeywords, setEditKeywords] = useState('')
  const [filters, setFilters] = useState(DEFAULT_FILTERS)

  const load = useCallback(() => {
    fetch('/api/sources').then(r => r.json()).then(setSources)
  }, [])

  useEffect(() => { load() }, [load])

  async function toggle(id: string, active: boolean) {
    await fetch(`/api/sources/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !active }),
    })
    load()
  }

  async function toggleAutoPublish(id: string, autoPublish: boolean) {
    await fetch(`/api/sources/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ auto_publish: !autoPublish }),
    })
    load()
  }

  async function remove(id: string) {
    if (!confirm('Delete this source?')) return
    await fetch(`/api/sources/${id}`, { method: 'DELETE' })
    load()
  }

  function startEdit(source: RssSource) {
    setEditingId(source.id)
    setEditName(source.name)
    setEditUrl(source.url)
    setEditKeywords((source.keywords ?? []).join(', '))
  }

  async function saveEdit(id: string) {
    const keywords = editKeywords.split(',').map(k => k.trim().toLowerCase()).filter(Boolean)
    await fetch(`/api/sources/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: editName, url: editUrl, keywords }),
    })
    setEditingId(null)
    load()
  }

  // Batch numbers are derived from active sources only — same grouping the
  // ingest schedule itself uses. Disabled sources carry no batch.
  const batches = useMemo(() => groupIntoBatches(sources.filter(s => s.active), BATCH_SIZE), [sources])

  const rows: SourceRow[] = useMemo(() => {
    const batchNumberById = new Map<string, number>()
    batches.forEach((batch, i) => batch.forEach(s => batchNumberById.set(s.id, i + 1)))
    return sources.map(s => ({ ...s, batchNumber: batchNumberById.get(s.id) ?? null }))
  }, [sources, batches])

  const filteredRows = useMemo(() => rows.filter(s => {
    const sourceQuery = filters.source.trim().toLowerCase()
    if (sourceQuery && !s.name.toLowerCase().includes(sourceQuery) && !s.url.toLowerCase().includes(sourceQuery)) return false

    const keywordQuery = filters.keywords.trim().toLowerCase()
    if (keywordQuery && !(s.keywords ?? []).some(k => k.toLowerCase().includes(keywordQuery))) return false

    if (filters.batch === 'disabled' && s.active) return false
    if (filters.batch !== 'all' && filters.batch !== 'disabled' && String(s.batchNumber ?? '') !== filters.batch) return false

    if (filters.drafts === 'has' && s.recent_drafts === 0) return false
    if (filters.drafts === 'none' && s.recent_drafts > 0) return false

    if (filters.autoPublish === 'auto' && !s.auto_publish) return false
    if (filters.autoPublish === 'manual' && s.auto_publish) return false

    return true
  }), [rows, filters])

  const hasActiveFilters = filters.source !== '' || filters.keywords !== '' || filters.batch !== 'all' || filters.drafts !== 'any' || filters.autoPublish !== 'all'
  const filteredActiveIds = filteredRows.filter(s => s.active).map(s => s.id)

  function setFilter<K extends keyof typeof DEFAULT_FILTERS>(key: K, value: (typeof DEFAULT_FILTERS)[K]) {
    setFilters(f => ({ ...f, [key]: value }))
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6" style={{ color: 'var(--text)' }}>RSS Sources</h1>

      <div className="flex items-center justify-between gap-3 mb-2 flex-wrap">
        <span className="text-xs" style={{ color: 'var(--muted)' }}>
          Showing {filteredRows.length} of {sources.length} source{sources.length !== 1 ? 's' : ''}
          {hasActiveFilters && (
            <button onClick={() => setFilters(DEFAULT_FILTERS)} className="ml-2 underline underline-offset-2" style={{ color: 'var(--accent)' }}>
              Clear filters
            </button>
          )}
        </span>
        {filteredActiveIds.length > 0 && (
          <IngestButton
            label={`Ingest ${filteredActiveIds.length} active source${filteredActiveIds.length !== 1 ? 's' : ''}`}
            sourceIds={filteredActiveIds}
            onDone={load}
          />
        )}
      </div>

      <div className="overflow-x-auto rounded-lg" style={{ border: '1px solid var(--border)' }}>
        <table className="w-full border-collapse text-sm" style={{ minWidth: '860px' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              <th className="text-left font-medium uppercase tracking-wide text-xs px-3 py-2" style={{ color: 'var(--muted)' }}>Source</th>
              <th className="text-left font-medium uppercase tracking-wide text-xs px-3 py-2" style={{ color: 'var(--muted)' }}>Keywords</th>
              <th className="text-left font-medium uppercase tracking-wide text-xs px-3 py-2" style={{ color: 'var(--muted)' }}>Batch</th>
              <th className="text-left font-medium uppercase tracking-wide text-xs px-3 py-2" style={{ color: 'var(--muted)' }}>Drafts</th>
              <th className="text-center font-medium uppercase tracking-wide text-xs px-3 py-2" style={{ color: 'var(--muted)' }}>Auto publishing</th>
              <th className="text-left font-medium uppercase tracking-wide text-xs px-3 py-2" style={{ color: 'var(--muted)' }}>Actions</th>
            </tr>
            <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
              <th className="px-3 py-1.5 font-normal">
                <input
                  type="text"
                  value={filters.source}
                  onChange={e => setFilter('source', e.target.value)}
                  placeholder="Filter name/URL…"
                  className={filterInputClass}
                  style={filterInputStyle}
                  aria-label="Filter by source name or URL"
                />
              </th>
              <th className="px-3 py-1.5 font-normal">
                <input
                  type="text"
                  value={filters.keywords}
                  onChange={e => setFilter('keywords', e.target.value)}
                  placeholder="Filter keyword…"
                  className={filterInputClass}
                  style={filterInputStyle}
                  aria-label="Filter by keyword"
                />
              </th>
              <th className="px-3 py-1.5 font-normal">
                <select
                  value={filters.batch}
                  onChange={e => setFilter('batch', e.target.value)}
                  className={filterInputClass}
                  style={filterInputStyle}
                  aria-label="Filter by batch"
                >
                  <option value="all">All</option>
                  {batches.map((_, i) => <option key={i} value={String(i + 1)}>Batch {i + 1}</option>)}
                  <option value="disabled">Disabled</option>
                </select>
              </th>
              <th className="px-3 py-1.5 font-normal">
                <select
                  value={filters.drafts}
                  onChange={e => setFilter('drafts', e.target.value as DraftsFilter)}
                  className={filterInputClass}
                  style={filterInputStyle}
                  aria-label="Filter by recent drafts"
                >
                  <option value="any">Any</option>
                  <option value="has">Has drafts</option>
                  <option value="none">None</option>
                </select>
              </th>
              <th className="px-3 py-1.5 font-normal">
                <select
                  value={filters.autoPublish}
                  onChange={e => setFilter('autoPublish', e.target.value as AutoPublishFilter)}
                  className={filterInputClass}
                  style={filterInputStyle}
                  aria-label="Filter by auto publishing"
                >
                  <option value="all">All</option>
                  <option value="auto">Auto</option>
                  <option value="manual">Manual</option>
                </select>
              </th>
              <th className="px-3 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {filteredRows.map(source => (
              editingId === source.id ? (
                <tr key={source.id} style={{ borderBottom: '1px solid var(--hairline, var(--border))' }}>
                  <td colSpan={6} className="px-3 py-3" style={{ background: 'var(--surface, var(--bg))' }}>
                    <div className="flex flex-col gap-2 max-w-xl">
                      <Input value={editName} onChange={e => setEditName(e.target.value)} placeholder="Name" />
                      <Input value={editUrl} onChange={e => setEditUrl(e.target.value)} placeholder="URL" />
                      <Input value={editKeywords} onChange={e => setEditKeywords(e.target.value)} placeholder="Keywords (comma-separated)" />
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => saveEdit(source.id)}>Save</Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>Cancel</Button>
                      </div>
                    </div>
                  </td>
                </tr>
              ) : (
                <tr
                  key={source.id}
                  style={{ borderBottom: '1px solid var(--hairline, var(--border))', background: 'var(--surface, var(--bg))', opacity: source.active ? 1 : 0.55 }}
                >
                  <td className="px-3 py-2 align-top">
                    <p className="font-medium" style={{ color: 'var(--text)' }}>{source.name}</p>
                    <p className="text-xs truncate max-w-[260px]" style={{ color: 'var(--muted)' }} title={source.url}>{source.url}</p>
                  </td>
                  <td className="px-3 py-2 align-top text-xs max-w-[220px] truncate" style={{ color: 'var(--muted)' }} title={source.keywords?.join(', ')}>
                    {source.keywords?.length > 0 ? source.keywords.join(', ') : '—'}
                  </td>
                  <td className="px-3 py-2 align-top text-xs whitespace-nowrap" style={{ color: 'var(--muted)' }}>
                    {source.active ? `Batch ${source.batchNumber}` : 'Disabled'}
                  </td>
                  <td className="px-3 py-2 align-top text-xs" style={{ color: source.recent_drafts > 0 ? 'var(--accent)' : 'var(--muted)' }}>
                    {source.recent_drafts}
                  </td>
                  <td className="px-3 py-2 align-top text-center">
                    <input
                      type="checkbox"
                      checked={source.auto_publish}
                      onChange={() => toggleAutoPublish(source.id, source.auto_publish)}
                      className="h-4 w-4 rounded cursor-pointer"
                      style={{ accentColor: 'var(--accent)' }}
                      aria-label={`Auto publishing for ${source.name}`}
                      title="Drafts from this source are approved automatically, without human review"
                    />
                  </td>
                  <td className="px-3 py-2 align-top">
                    <div className="flex gap-1.5 flex-wrap items-center">
                      {source.active && <IngestButton label="Ingest" sourceIds={[source.id]} onDone={load} />}
                      <Button size="sm" variant="secondary" onClick={() => startEdit(source)}>Edit</Button>
                      <Button size="sm" variant="secondary" onClick={() => toggle(source.id, source.active)}>{source.active ? 'Disable' : 'Enable'}</Button>
                      <Button size="sm" variant="danger" onClick={() => remove(source.id)}>Delete</Button>
                    </div>
                  </td>
                </tr>
              )
            ))}
            {filteredRows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-sm" style={{ color: 'var(--muted)' }}>
                  No sources match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Add source — bottom, width-constrained so fields stay readable */}
      <div className="mt-10 max-w-xl">
        <h2 className="text-sm font-medium uppercase tracking-wide mb-4" style={{ color: 'var(--muted)' }}>Add source</h2>
        <SourceForm onAdded={load} />

        <div className="mt-6 rounded-lg p-4 text-sm" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', color: 'var(--muted)' }}>
          <p className="font-medium mb-1" style={{ color: 'var(--text)' }}>How batches work</p>
          <p>Active sources are grouped into batches of {BATCH_SIZE} by the order they were added. Filter the Batch column to one batch and use the ingest button above the table to run it independently — useful for testing a specific source or staying within execution time limits.</p>
          <p className="mt-2">New sources are automatically placed into the next available batch slot.</p>
          <p className="mt-2 font-mono text-xs" style={{ color: 'var(--muted)' }}>Daily ingest runs via GitHub Actions at 10:30 UTC.</p>
        </div>
      </div>
    </div>
  )
}
