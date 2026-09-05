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

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.email !== process.env.ADMIN_EMAIL) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

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
