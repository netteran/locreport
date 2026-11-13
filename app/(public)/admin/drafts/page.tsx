'use client'
import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Draft } from '@/lib/types'
import { Badge } from '@/components/ui/badge'

function statusVariant(status: Draft['status']) {
  if (status === 'approved') return 'success'
  if (status === 'rejected') return 'danger'
  if (status === 'rerun') return 'rerun'
  if (status === 'rerunning') return 'muted'
  return 'warning'
}

function statusLabel(status: Draft['status']) {
  if (status === 'rerun') return 'Re-run draft'
  if (status === 'rerunning') return 'Re-running…'
  return status
}

const STATUS_FILTERS = [
  { label: 'All', value: 'all' },
  { label: 'Pending', value: 'pending' },
  { label: 'Re-run', value: 'rerun' },
  { label: 'Approved', value: 'approved' },
  { label: 'Rejected', value: 'rejected' },
]

export default function DraftsPage() {
  const searchParams = useSearchParams()
  const statusFilter = searchParams.get('status') ?? 'pending'

  const [drafts, setDrafts] = useState<Draft[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setSelected(new Set())
    try {
      const r = await fetch('/api/drafts')
      const data: Draft[] = await r.json()
      const filtered = statusFilter === 'all' ? data : data.filter(d => d.status === statusFilter)
      setDrafts(filtered)
    } catch {
      setError('Failed to load drafts.')
    }
    setLoading(false)
  }, [statusFilter])

  useEffect(() => { load() }, [load])

  function toggleAll() {
    if (selected.size === drafts.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(drafts.map(d => d.id)))
    }
  }

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function bulkReject() {
    if (!selected.size) return
    setBulkBusy(true)
    await fetch('/api/drafts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: Array.from(selected), status: 'rejected' }),
    })
    await load()
    setBulkBusy(false)
  }

  async function bulkDelete() {
    if (!selected.size) return
    if (!confirm(`Permanently delete ${selected.size} draft${selected.size > 1 ? 's' : ''}? This cannot be undone.`)) return
    setBulkBusy(true)
    await fetch('/api/drafts', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: Array.from(selected) }),
    })
    await load()
    setBulkBusy(false)
  }

  const allSelected = drafts.length > 0 && selected.size === drafts.length
  const someSelected = selected.size > 0

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div><h1 className="text-2xl font-bold" style={{ color: 'var(--text)' }}>Drafts</h1><Link className="text-sm underline" href="/admin/candidates">Create an article from sources →</Link></div>
        <div className="flex flex-wrap gap-2">
          {STATUS_FILTERS.map(({ label, value }) => (
            <a
              key={value}
              href={value === 'pending' ? '/admin/drafts' : `/admin/drafts?status=${value}`}
              className="text-sm px-3 py-1 rounded-full transition-colors"
              style={
                statusFilter === value
                  ? { background: 'var(--accent)', color: '#fff' }
                  : { background: 'var(--bg-secondary)', color: 'var(--muted)' }
              }
            >
              {label}
            </a>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-red-500 mb-4">{error}</p>}

      {someSelected && (
        <div className="flex items-center gap-3 mb-4 px-3 py-2 rounded-lg" style={{ background: 'var(--accent-soft)', border: '1px solid var(--border)' }}>
          <span className="text-sm" style={{ color: 'var(--muted)' }}>{selected.size} selected</span>
          {statusFilter !== 'rejected' && (
            <button
              onClick={bulkReject}
              disabled={bulkBusy}
              className="text-sm font-medium text-red-500 hover:text-red-400 disabled:opacity-50"
            >
              {bulkBusy ? 'Rejecting…' : 'Reject selected'}
            </button>
          )}
          {statusFilter === 'rejected' && (
            <button
              onClick={bulkDelete}
              disabled={bulkBusy}
              className="text-sm font-medium text-red-500 hover:text-red-400 disabled:opacity-50"
            >
              {bulkBusy ? 'Deleting…' : 'Delete selected'}
            </button>
          )}
          <button
            onClick={() => setSelected(new Set())}
            className="text-sm ml-auto"
            style={{ color: 'var(--muted)' }}
          >
            Clear
          </button>
        </div>
      )}

      <div className="max-w-[760px]">
        {!loading && drafts.length > 0 && (
          <div className="flex items-center gap-3 pb-3 mb-1" style={{ borderBottom: '1px solid var(--border)' }}>
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleAll}
              className="h-4 w-4 rounded cursor-pointer"
              style={{ accentColor: 'var(--accent)' }}
              aria-label="Select all"
            />
            <span className="text-xs" style={{ color: 'var(--muted)' }}>Select all</span>
          </div>
        )}

        {loading && <p className="text-sm" style={{ color: 'var(--muted)' }}>Loading…</p>}

        {!loading && drafts.map(draft => {
          const ingestedDate = new Date(draft.created_at).toLocaleDateString('en-GB')
          const sourceDate = draft.source_published_at
            ? new Date(draft.source_published_at).toLocaleDateString('en-GB')
            : null
          return (
            <div key={draft.id} className="py-4 last:border-0 flex items-start gap-3" style={{ borderBottom: '1px solid var(--border)' }}>
              <input
                type="checkbox"
                checked={selected.has(draft.id)}
                onChange={() => toggle(draft.id)}
                className="h-4 w-4 mt-0.5 rounded cursor-pointer shrink-0"
                style={{ accentColor: 'var(--accent)' }}
                aria-label={`Select ${draft.title}`}
              />
              <div className="flex-1 flex items-start justify-between gap-4">
                <div>
                  <Link
                    href={`/admin/drafts/${draft.id}`}
                    className="font-medium hover:underline"
                    style={{ color: 'var(--text)' }}
                  >
                    {draft.title}
                  </Link>
                  <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
                    {sourceDate
                      ? <><span title="Source published">{sourceDate}</span> · <span title="Ingested">{ingestedDate}</span></>
                      : ingestedDate
                    }
                    {draft.source_url && (() => { try { return ` · ${new URL(draft.source_url!).hostname}` } catch { return ` · ${draft.source_url}` } })()}
                  </p>
                </div>
                <Badge variant={statusVariant(draft.status)}>{statusLabel(draft.status)}</Badge>
              </div>
            </div>
          )
        })}

        {!loading && !drafts.length && <p className="text-sm" style={{ color: 'var(--muted)' }}>No drafts found.</p>}
      </div>
    </div>
  )
}
