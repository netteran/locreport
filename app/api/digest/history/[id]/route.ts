import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

type Params = { params: Promise<{ id: string }> }

// Re-serves one past send's exact stored copy, admin session only. Rows
// written before the subject/html columns existed (supabase/migrations/
// 20260917_digest_sends_html.sql) have neither — those predate this feature
// and are shown as unavailable rather than recomposed, since a subscriber's
// preferences may have changed since they were sent.
export async function GET(_req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.email !== process.env.ADMIN_EMAIL) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const service = createServiceClient()
  const { data: row, error } = await service
    .from('digest_sends')
    .select('html')
    .eq('id', id)
    .single()

  if (error || !row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!row.html) {
    return NextResponse.json({ error: 'No stored copy for this send — it predates email snapshots.' }, { status: 404 })
  }

  return new NextResponse(row.html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}
