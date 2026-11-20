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
    e.target.value = ''
    if (file) upload(file)
  }, [upload])

  return (
    <div className="admin-directory-logo">
      <span className="admin-directory-field-label">Logo</span>
      <div className="admin-directory-logo-controls">
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={onFileChange}
        />
        <button
          className="admin-directory-logo-picker"
          type="button"
          disabled={uploading}
          data-drag-over={dragOver}
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          aria-describedby="directory-logo-limit"
        >
          {currentUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={currentUrl} alt="" />
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="m3 17 5-5 4 4 4-5 5 6" />
            </svg>
          )}
          {uploading ? 'Uploading…' : currentUrl ? 'Replace logo' : 'Choose logo'}
        </button>
        <span className="admin-directory-logo-limit" id="directory-logo-limit">Image up to 2 MB</span>
      </div>
      {error && <p className="admin-directory-logo-error" role="alert">{error}</p>}
    </div>
  )
}
