import type { NextRequest } from 'next/server'
import sharp from 'sharp'
import { companyLogoStorageUrl } from '@/lib/email/companyLogo'

export const runtime = 'nodejs'

const MAX_LOGO_BYTES = 2 * 1024 * 1024

export async function GET(req: NextRequest, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params
  if (!file.endsWith('.png')) return new Response(null, { status: 404 })

  try {
    const source = companyLogoStorageUrl(file.slice(0, -4), req.nextUrl.searchParams.get('v'))
    if (!source) return new Response(null, { status: 404 })

    const response = await fetch(source, { redirect: 'error', signal: AbortSignal.timeout(5000) })
    const type = response.headers.get('content-type')?.split(';')[0]?.trim()
    if (!response.ok || !response.body || !['image/svg+xml', 'image/webp', 'image/avif'].includes(type ?? '') ||
        Number(response.headers.get('content-length')) > MAX_LOGO_BYTES) {
      await response.body?.cancel()
      return new Response(null, { status: 404 })
    }

    const chunks: Uint8Array[] = []
    let size = 0
    const reader = response.body.getReader()
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_LOGO_BYTES) {
        await reader.cancel()
        return new Response(null, { status: 404 })
      }
      chunks.push(value)
    }

    // Rasterize into a square so the mark stays centered on clients without
    // object-fit support. Keep transparent padding around wide logos.
    const png = await sharp(Buffer.concat(chunks), { limitInputPixels: 4_000_000 })
      .resize(112, 112, { fit: 'contain', background: '#00000000' })
      .png()
      .toBuffer()
    return new Response(new Uint8Array(png), { headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=3600, s-maxage=86400',
    } })
  } catch {
    return new Response(null, { status: 404 })
  }
}
