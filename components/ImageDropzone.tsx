'use client'
import { useCallback, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { safeImageUrl } from '@/lib/utils'
import {
  ALLOWED_IMAGE_LABEL,
  ALLOWED_IMAGE_TYPES,
  ARTICLE_IMAGE_BUCKET,
  MAX_IMAGE_BYTES,
  formatBytes,
  isAllowedImageType,
} from '@/lib/storage'
import { Label } from '@/components/ui/label'

interface Props {
  /** Current image URL, or '' for none. */
  value: string
  /** Called with the public URL of a freshly uploaded image, or '' on remove. */
  onChange: (url: string) => void
  label?: string
  hint?: string
}

/**
 * Drag-and-drop lead image field for the admin editors. Accepts a dropped
 * file, a click-to-browse pick, or a pasted image, uploads it to the
 * `locreport` Supabase Storage bucket, and reports back the public URL that
 * gets stored in `image_url`.
 *
 * The upload is a two-step handshake: /api/uploads/article-image authorises
 * the admin and returns a signed upload URL, then the browser sends the bytes
 * straight to Supabase.
 */
export function ImageDropzone({ value, onChange, label = 'Lead image', hint }: Props) {
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const busy = useRef(false)

  const upload = useCallback(async (file: File) => {
    if (busy.current) return
    if (!isAllowedImageType(file.type)) {
      setError(`Unsupported file type. Allowed: ${ALLOWED_IMAGE_LABEL}.`)
      return
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError(`Image is ${formatBytes(file.size)} — the limit is ${formatBytes(MAX_IMAGE_BYTES)}.`)
      return
    }

    busy.current = true
    setUploading(true)
    setError('')
    try {
      const res = await fetch('/api/uploads/article-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: file.name, contentType: file.type, size: file.size }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? `Upload failed (${res.status})`)
        return
      }

      const supabase = createClient()
      const { error: upErr } = await supabase.storage
        .from(ARTICLE_IMAGE_BUCKET)
        .uploadToSignedUrl(data.path, data.token, file, {
          contentType: file.type,
          // Object keys are unique per upload, so the bytes never change.
          cacheControl: '31536000',
        })
      if (upErr) {
        setError(upErr.message)
        return
      }

      onChange(data.publicUrl)
    } catch {
      setError('Network error — please try again.')
    } finally {
      busy.current = false
      setUploading(false)
    }
  }, [onChange])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) {
      upload(file)
      return
    }
    setError('That drop carried no image file — save the image to disk first, then drop it here.')
  }, [upload])

  const onPaste = useCallback((e: React.ClipboardEvent) => {
    const file = e.clipboardData.files[0]
    if (file) {
      e.preventDefault()
      upload(file)
    }
  }, [upload])

  const preview = safeImageUrl(value)

  return (
    <div>
      <Label>{label}</Label>
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onPaste={onPaste}
        onClick={() => inputRef.current?.click()}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            inputRef.current?.click()
          }
        }}
        role="button"
        tabIndex={0}
        aria-label={preview ? 'Replace image' : 'Upload image'}
        aria-busy={uploading}
        style={{
          border: `2px dashed ${dragOver ? 'var(--accent)' : 'var(--border)'}`,
          borderRadius: 'var(--radius-md, 8px)',
          background: dragOver ? 'var(--accent-soft)' : 'var(--bg-secondary)',
          padding: preview ? 8 : '28px 16px',
          textAlign: 'center',
          cursor: 'pointer',
          transition: 'border-color .15s, background .15s',
          opacity: uploading ? 0.6 : 1,
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ALLOWED_IMAGE_TYPES.join(',')}
          className="sr-only"
          onClick={e => e.stopPropagation()}
          onChange={e => {
            const file = e.target.files?.[0]
            // Reset so re-picking the same file fires change again.
            e.target.value = ''
            if (file) upload(file)
          }}
        />

        {preview ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={preview}
              alt=""
              style={{
                width: '100%',
                maxWidth: 360,
                aspectRatio: '16 / 9',
                objectFit: 'cover',
                borderRadius: 'var(--radius-sm, 4px)',
                border: '1px solid var(--border)',
                background: 'var(--surface)',
                margin: '0 auto',
                display: 'block',
              }}
            />
            <p className="text-xs mt-2" style={{ color: 'var(--muted)' }}>
              {uploading ? 'Uploading…' : 'Click, drop or paste to replace'}
            </p>
          </>
        ) : (
          <>
            <svg
              className="mx-auto mb-2" width="26" height="26" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
              style={{ color: 'var(--muted)' }} aria-hidden="true"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
            <p className="text-sm" style={{ color: 'var(--text)' }}>
              {uploading ? 'Uploading…' : 'Drop an image here, or click to browse'}
            </p>
            <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
              {ALLOWED_IMAGE_LABEL} · max {formatBytes(MAX_IMAGE_BYTES)} · or paste an image while this field is focused
            </p>
          </>
        )}
      </div>

      {error && <p className="text-xs mt-1" style={{ color: '#dc2626' }}>{error}</p>}

      {value && (
        <div className="flex items-center gap-2 mt-1">
          <span
            className="text-xs font-mono truncate"
            style={{ color: 'var(--muted)', minWidth: 0, flex: 1 }}
            title={value}
          >
            {value}
          </span>
          <button
            type="button"
            onClick={() => { setError(''); onChange('') }}
            disabled={uploading}
            className="text-xs underline shrink-0 disabled:opacity-50"
            style={{ color: 'var(--muted)' }}
          >
            Remove
          </button>
        </div>
      )}

      {hint && <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>{hint}</p>}
    </div>
  )
}
