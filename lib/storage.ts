// Supabase Storage bucket holding article imagery. It predates the drag-and-
// drop field — article images were uploaded to it by hand from the Supabase
// dashboard, and live articles already reference objects at its root.
//
// Uploads are authorised by /api/uploads/article-image (admin session →
// service-role signed upload URL) and the bytes go straight from the browser
// to Supabase, so the bucket needs no RLS policy for writes. It is public so
// that a plain <img src> works for readers.
export const ARTICLE_IMAGE_BUCKET = 'images'

// Object key prefix inside the bucket. Hand-uploaded images sit at the bucket
// root; namespacing new uploads keeps the two sets distinguishable and leaves
// room for other asset kinds later.
export const ARTICLE_IMAGE_PREFIX = 'articles'

// Per-file ceiling, mirrored onto the bucket so Supabase enforces it too.
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024

// SVG is deliberately absent: lead images are photographs, and allowing
// script-bearing SVG into a public bucket buys nothing here.
export const ALLOWED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/gif',
] as const

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/gif': 'gif',
}

export function isAllowedImageType(type: string | undefined | null): boolean {
  return !!type && (ALLOWED_IMAGE_TYPES as readonly string[]).includes(type)
}

// Human-readable list for error copy and hints ("JPG, PNG, WebP, AVIF, GIF").
export const ALLOWED_IMAGE_LABEL = ALLOWED_IMAGE_TYPES
  .map(t => EXTENSIONS[t].toUpperCase())
  .join(', ')

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(bytes % (1024 * 1024) === 0 ? 0 : 1)} MB`
}

// Builds a collision-free object key: articles/2026/09/<random>-<name>.<ext>.
// The original file name survives (slugified) so uploads stay recognisable in
// the Supabase dashboard, while the random prefix makes every key immutable —
// which is what lets the objects be served with a one-year cache header.
export function articleImagePath(fileName: string, contentType: string): string {
  const ext = EXTENSIONS[contentType] ?? 'jpg'
  const base = fileName
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'image'
  const now = new Date()
  const yyyy = now.getUTCFullYear()
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0')
  const unique = crypto.randomUUID().slice(0, 8)
  return `${ARTICLE_IMAGE_PREFIX}/${yyyy}/${mm}/${unique}-${base}.${ext}`
}
