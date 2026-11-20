import { createServiceClient } from '@/lib/supabase/server'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^[a-f0-9]{64}$/.test(id)) return new Response('Edition not found.', { status: 404 })

  const { data, error } = await createServiceClient()
    .from('weekly_newsletter_web_editions')
    .select('html')
    .eq('id', id)
    .maybeSingle()

  if (error) return new Response('Edition unavailable.', { status: 503 })
  if (!data) return new Response('Edition not found.', { status: 404 })

  return new Response(data.html, { headers: {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'public, max-age=3600, s-maxage=86400',
    'Content-Security-Policy': "default-src 'none'; img-src https: http:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex',
  } })
}
