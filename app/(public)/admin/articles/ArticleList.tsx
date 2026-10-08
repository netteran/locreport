'use client'

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { Article } from '@/lib/types'
import { DeleteButton } from './DeleteButton'
import { deleteArticles } from './actions'

type Row = Pick<Article, 'id' | 'title' | 'slug' | 'published_at' | 'article_type' | 'publisher'>

export function ArticleList({ articles }: { articles: Row[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirming, setConfirming] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const allIds = useMemo(() => articles.map((a) => a.id), [articles])
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id))

  function toggle(id: string) {
    setConfirming(false)
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    setConfirming(false)
    setSelected(allSelected ? new Set() : new Set(allIds))
  }

  function confirmDelete() {
    const ids = [...selected].filter((id) => allIds.includes(id))
    startTransition(async () => {
      try {
        const r = await deleteArticles(ids)
        setMessage(`Deleted ${r.deleted} article${r.deleted === 1 ? '' : 's'} and ${r.factsDeleted} Fact Flow fact${r.factsDeleted === 1 ? '' : 's'}.`)
        setSelected(new Set())
      } catch (err) {
        setMessage(`Delete failed: ${(err as Error).message}`)
      }
      setConfirming(false)
    })
  }

  const count = selected.size

  return (
    <div>
      <div
        className="py-2 flex items-center justify-between gap-4 sticky top-0 z-10"
        style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg)' }}
      >
        <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'var(--muted)' }}>
          <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all articles" />
          {count > 0 ? `${count} selected` : 'Select all'}
        </label>
        {count > 0 && (
          confirming ? (
            <span className="flex items-center gap-1">
              <span className="text-xs mr-1" style={{ color: 'var(--muted)' }}>
                Delete {count} article{count === 1 ? '' : 's'} and their facts?
              </span>
              <button
                onClick={confirmDelete}
                disabled={pending}
                className="text-xs px-2 py-1 rounded-md bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
              >
                {pending ? '…' : 'Yes'}
              </button>
              <button
                onClick={() => setConfirming(false)}
                disabled={pending}
                className="text-xs px-2 py-1 rounded-md transition-colors"
                style={{ background: 'var(--bg-secondary)', color: 'var(--muted)', border: '1px solid var(--border)' }}
              >
                No
              </button>
            </span>
          ) : (
            <button
              onClick={() => { setMessage(null); setConfirming(true) }}
              className="text-xs px-3 py-1 rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors"
            >
              Delete selected ({count})
            </button>
          )
        )}
      </div>
      {message && (
        <p className="text-xs py-2" style={{ color: 'var(--muted)' }}>{message}</p>
      )}
      {articles.map((a) => (
        <div
          key={a.id}
          className="py-4 flex items-start justify-between gap-4"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <label className="flex items-start gap-3 cursor-pointer min-w-0">
            <input
              type="checkbox"
              className="mt-1 shrink-0"
              checked={selected.has(a.id)}
              onChange={() => toggle(a.id)}
              aria-label={`Select ${a.title}`}
            />
            <span>
              <span className="block font-medium text-sm" style={{ color: 'var(--text)' }}>{a.title}</span>
              <span className="block text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
                {a.published_at ? new Date(a.published_at).toLocaleDateString() : ''} · {a.publisher ?? '—'}
              </span>
            </span>
          </label>
          <div className="flex items-center gap-2 shrink-0">
            <Link
              href={`/admin/articles/${a.id}`}
              className="text-sm px-3 py-1 rounded-lg transition-colors"
              style={{ background: 'var(--bg-secondary)', color: 'var(--muted)', border: '1px solid var(--border)' }}
            >
              Edit
            </Link>
            <DeleteButton id={a.id} />
          </div>
        </div>
      ))}
    </div>
  )
}
