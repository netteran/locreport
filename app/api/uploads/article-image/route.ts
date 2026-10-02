import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import {
  ALLOWED_IMAGE_LABEL,
  ALLOWED_IMAGE_TYPES,
  ARTICLE_IMAGE_BUCKET,
  MAX_IMAGE_BYTES,
  articleImagePath,
  formatBytes,
  isAllowedImageType,
} from '@/lib/storage'

// The image bytes never pass through this route. It authenticates the admin,
// makes sure the bucket exists, and hands back a short-lived signed upload URL
// the browser posts the file to directly — which keeps large images clear of
// the serverless request body limit and off the function's execution time.

type ServiceClient = ReturnType<typeof createServiceClient>

async function ensureBucket(service: ServiceClient): Promise<string | null> {
  const { data } = await service.storage.getBucket(ARTICLE_IMAGE_BUCKET)
  if (data) return null

  const { error } = await service.storage.createBucket(ARTICLE_IMAGE_BUCKET, {
    public: true,
    fileSizeLimit: MAX_IMAGE_BYTES,
    allowedMimeTypes: [...ALLOWED_IMAGE_TYPES],
  })
  // A concurrent upload may have won the race — that is a success, not a fault.
  if (error && !/already exists/i.test(error.message)) {
    return `Could not create the "${ARTICLE_IMAGE_BUCKET}" storage bucket: ${error.message}`
  }
  return null
}

async function isAdmin(): Promise<boolean> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return !!user && user.email === process.env.ADMIN_EMAIL
}

export interface LibraryImage {
  path: string
  url: string
  size: number
  contentType: string
  createdAt: string | null
  /** How many articles currently use this image as their lead image. */
  usedBy: number
}

// Storage's list() is one folder deep, so walk the tree: the hand-uploaded
// images at the bucket root plus everything under articles/<yyyy>/<mm>/.
// Folders come back as entries with a null id.
async function listAll(service: ServiceClient, prefix = '', depth = 0): Promise<
  { path: string; size: number; contentType: string; createdAt: string | null }[]
> {
  if (depth > 4) return []
  const out: { path: string; size: number; contentType: string; createdAt: string | null }[] = []
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await service.storage
      .from(ARTICLE_IMAGE_BUCKET)
      .list(prefix, { limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } })
    if (error) throw new Error(error.message)
    if (!data?.length) break
    for (const entry of data) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.id === null) {
        out.push(...await listAll(service, path, depth + 1))
        continue
      }
      const meta = (entry.metadata ?? {}) as { size?: number; mimetype?: string }
      // Skips Supabase's .emptyFolderPlaceholder and anything not an image.
      if (!isAllowedImageType(meta.mimetype)) continue
      out.push({
        path,
        size: meta.size ?? 0,
        contentType: meta.mimetype ?? '',
        createdAt: entry.created_at ?? null,
      })
    }
    if (data.length < 1000) break
  }
  return out
}

// The image library behind the editors' "Choose from library" picker: every
// image in the bucket, newest first, with how many articles use each.
export async function GET() {
  if (!await isAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceClient()
  let files
  try {
    files = await listAll(service)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }

  // Count usage by object path, matched against the public URL in image_url.
  const marker = `/storage/v1/object/public/${ARTICLE_IMAGE_BUCKET}/`
  const usage = new Map<string, number>()
  const { data: rows } = await service
    .from('articles')
    .select('image_url')
    .like('image_url', `%${marker}%`)
  for (const { image_url } of rows ?? []) {
    const path = decodeURIComponent(String(image_url).split(marker)[1] ?? '').split('?')[0]
    if (path) usage.set(path, (usage.get(path) ?? 0) + 1)
  }

  const bucket = service.storage.from(ARTICLE_IMAGE_BUCKET)
  const images: LibraryImage[] = files
    .map(f => ({ ...f, url: bucket.getPublicUrl(f.path).data.publicUrl, usedBy: usage.get(f.path) ?? 0 }))
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))

  return NextResponse.json({ images }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(req: NextRequest) {
  if (!await isAdmin()) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { fileName, contentType, size } = await req.json().catch(() => ({}))

  if (!isAllowedImageType(contentType)) {
    return NextResponse.json(
      { error: `Unsupported image type. Allowed: ${ALLOWED_IMAGE_LABEL}.` },
      { status: 400 }
    )
  }
  if (typeof size !== 'number' || size <= 0) {
    return NextResponse.json({ error: 'Missing file size.' }, { status: 400 })
  }
  if (size > MAX_IMAGE_BYTES) {
    return NextResponse.json(
      { error: `Image is ${formatBytes(size)} — the limit is ${formatBytes(MAX_IMAGE_BYTES)}.` },
      { status: 400 }
    )
  }

  const service = createServiceClient()
  const bucketError = await ensureBucket(service)
  if (bucketError) return NextResponse.json({ error: bucketError }, { status: 500 })

  const path = articleImagePath(typeof fileName === 'string' ? fileName : 'image', contentType)
  const { data, error } = await service.storage
    .from(ARTICLE_IMAGE_BUCKET)
    .createSignedUploadUrl(path)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const { data: pub } = service.storage.from(ARTICLE_IMAGE_BUCKET).getPublicUrl(path)
  return NextResponse.json({ path: data.path, token: data.token, publicUrl: pub.publicUrl })
}
