'use client'
import { useState, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'

interface Props {
  slug: string
  currentUrl?: string
  onUploaded: (url: string) => void
}

export function LogoUpload({ slug, currentUrl, onUploaded }: Props) {
  const [uploading, setUploading] = useState(false)
  const [preview, setPreview] = useState<string | null>(currentUrl || null)
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const upload = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('Please upload an image file.')
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      setError('File must be under 2 MB.')
      return
    }
    if (!slug) {
      setError('Enter a name/slug first so the logo can be named.')
      return
    }

    setUploading(true)
    setError('')

    const ext = file.name.split('.').pop() || 'png'
    const path = `${slug}.${ext}`
    const supabase = createClient()

    const { error: upErr } = await supabase.storage
      .from('directory-logos')
      .upload(path, file, { upsert: true })

    if (upErr) {
      setError(upErr.message)
      setUploading(false)
      return
    }

    const { data } = supabase.storage.from('directory-logos').getPublicUrl(path)
    // The object key is stable (`<slug>.<ext>`) so an upsert reuses the same
    // public URL, and Supabase serves storage objects through a CDN with a
    // max-age. Without a version marker, replacing a logo keeps serving the
    // previous bytes until that expires. A stable key plus a versioned URL
    // gets both: no orphaned objects, and a replacement that shows up at once.
    const url = `${data.publicUrl}?v=${Date.now()}`
    setPreview(url)
    onUploaded(url)
    setUploading(false)
  }, [slug, onUploaded])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) upload(file)
  }, [upload])

  const onFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) upload(file)
  }, [upload])

  const dropStyle: React.CSSProperties = {
    border: `2px dashed ${dragOver ? 'var(--accent)' : 'var(--border)'}`,
    borderRadius: 10,
    padding: '16px 12px',
    textAlign: 'center',
    cursor: 'pointer',
    transition: 'border-color 0.15s, background 0.15s',
    background: dragOver ? 'var(--accent-soft)' : 'var(--bg-secondary)',
    position: 'relative',
  }

  return (
    <div>
      <label className="text-xs mb-1 block" style={{ color: 'var(--muted)' }}>Logo</label>
      <div
        style={dropStyle}
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={e => e.key === 'Enter' && inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={onFileChange}
        />
        {preview ? (
          <div className="flex items-center gap-3 justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt="Logo preview" style={{ width: 48, height: 48, objectFit: 'contain', borderRadius: 6, background: 'var(--surface)', border: '1px solid var(--border)', padding: 4 }} />
            <div className="text-left">
              <p className="text-xs font-medium" style={{ color: 'var(--text)' }}>Logo uploaded</p>
              <p className="text-xs" style={{ color: 'var(--muted)' }}>
                {uploading ? 'Uploading…' : 'Click or drop to replace'}
              </p>
            </div>
          </div>
        ) : (
          <div>
            <svg className="mx-auto mb-1" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--muted)' }}>
              <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
            </svg>
            <p className="text-xs" style={{ color: 'var(--muted)' }}>
              {uploading ? 'Uploading…' : 'Drop logo here or click to browse'}
            </p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--muted)', opacity: 0.6 }}>PNG, SVG, JPG · max 2 MB</p>
          </div>
        )}
      </div>
      {error && <p className="text-xs mt-1" style={{ color: 'red' }}>{error}</p>}
    </div>
  )
}
