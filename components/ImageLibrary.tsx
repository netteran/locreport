'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { formatBytes } from '@/lib/storage'
import type { LibraryImage } from '@/app/api/uploads/article-image/route'

export type { LibraryImage }

// One fetch shared by every picker on the page (the draft editor and the
// article editor each have one field, but this keeps it cheap regardless).
// invalidateImageLibrary() after an upload so the new image shows up.
let cache: Promise<LibraryImage[]> | null = null

export function loadImageLibrary(): Promise<LibraryImage[]> {
  if (!cache) {
    cache = fetch('/api/uploads/article-image', { cache: 'no-store' })
      .then(async res => {
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error ?? `Could not load the image library (${res.status})`)
        return (data.images ?? []) as LibraryImage[]
      })
      .catch(err => { cache = null; throw err })
  }
  return cache
}

export function invalidateImageLibrary() {
  cache = null
}

/** "articles/2026/09/af328d69-gala-board.jpg" → "gala-board.jpg" */
export function displayName(path: string): string {
  const file = path.split('/').pop() ?? path
  return file.replace(/^[0-9a-f]{8}-/, '')
}

/**
 * Looks for an image already in the bucket that is byte-for-byte the same as
 * `file`, so dropping the Google Translate logo a second time reuses the
 * stored one instead of adding another copy. Size is the cheap pre-filter;
 * only same-size candidates are downloaded and compared.
 */
export async function findDuplicate(file: File): Promise<LibraryImage | null> {
  let images: LibraryImage[]
  try {
    images = await loadImageLibrary()
  } catch {
    return null // no library, no dedupe — the upload still goes ahead
  }
  const candidates = images.filter(img => img.size === file.size)
  if (!candidates.length) return null
  const mine = new Uint8Array(await file.arrayBuffer())
  for (const img of candidates) {
    try {
      const res = await fetch(img.url, { cache: 'force-cache' })
      if (!res.ok) continue
      const theirs = new Uint8Array(await res.arrayBuffer())
      if (theirs.length !== mine.length) continue
      let same = true
      for (let i = 0; i < mine.length; i++) {
        if (mine[i] !== theirs[i]) { same = false; break }
      }
      if (same) return img
    } catch {
      /* unreachable candidate — just not a match */
    }
  }
  return null
}

interface PickerProps {
  /** The field's current URL, marked as selected in the grid. */
  value: string
  onPick: (url: string) => void
  disabled?: boolean
}

/**
 * "Choose from library" dropdown: a searchable grid of thumbnails of every
 * image already in the `images` bucket, so a recurring logo (Google
 * Translate, DeepL…) is picked rather than uploaded again.
 */
export function ImageLibraryPicker({ value, onPick, disabled }: PickerProps) {
  const [open, setOpen] = useState(false)
  const [images, setImages] = useState<LibraryImage[] | null>(null)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const load = useCallback((fresh = false) => {
    if (fresh) invalidateImageLibrary()
    setError('')
    loadImageLibrary()
      .then(setImages)
      .catch(err => setError((err as Error).message))
  }, [])

  // Load on first open; refresh each time it is reopened so a fresh upload
  // from the other editor tab is there too.
  useEffect(() => {
    if (!open) return
    load(images !== null)
    setTimeout(() => searchRef.current?.focus(), 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Close on Esc or a click outside the dropdown.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    function onDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [open])

  const shown = useMemo(() => {
    if (!images) return []
    const q = query.trim().toLowerCase()
    return q ? images.filter(img => img.path.toLowerCase().includes(q)) : images
  }, [images, query])

  return (
    <div className="image-library" ref={rootRef}>
      <button
        type="button"
        className="image-library__toggle"
        onClick={() => setOpen(v => !v)}
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" />
          <rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" />
        </svg>
        Choose from library{images ? ` (${images.length})` : ''}
        <svg className="image-library__chevron" width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="image-library__panel" role="dialog" aria-label="Image library">
          <div className="image-library__bar">
            <input
              ref={searchRef}
              type="search"
              className="image-library__search"
              placeholder="Search by file name…"
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
            <span className="image-library__count">
              {images ? `${shown.length} of ${images.length}` : ''}
            </span>
            <button type="button" className="image-library__refresh" onClick={() => load(true)} title="Reload the library">
              Refresh
            </button>
          </div>

          {error && <p className="image-library__msg image-library__msg--error">{error}</p>}
          {!error && !images && <p className="image-library__msg">Loading images…</p>}
          {images && shown.length === 0 && (
            <p className="image-library__msg">
              {images.length ? 'No image matches that name.' : 'The library is empty — upload the first image above.'}
            </p>
          )}

          {shown.length > 0 && (
            <ul className="image-library__grid">
              {shown.map(img => {
                const selected = img.url === value
                return (
                  <li key={img.path}>
                    <button
                      type="button"
                      className={`image-library__tile${selected ? ' is-selected' : ''}`}
                      onClick={() => { onPick(img.url); setOpen(false) }}
                      title={`${img.path}\n${formatBytes(img.size)}${img.createdAt ? ` · ${img.createdAt.slice(0, 10)}` : ''}`}
                      aria-pressed={selected}
                    >
                      <span className="image-library__thumb">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={img.url} alt="" loading="lazy" decoding="async" />
                        {selected && <span className="image-library__check" aria-hidden="true">✓</span>}
                      </span>
                      <span className="image-library__name">{displayName(img.path)}</span>
                      <span className="image-library__meta">
                        {img.usedBy > 0 ? `used ×${img.usedBy}` : 'unused'}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
