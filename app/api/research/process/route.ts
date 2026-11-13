import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, isCronRequest, unauthorized } from '@/lib/adminAuth'
import { createServiceClient } from '@/lib/supabase/server'
import { checked, processPendingCandidates, refreshStoryGroups } from '@/lib/research'

export const maxDuration = 300
export async function POST(req: NextRequest) {
  if (!isCronRequest(req) && !(await requireAdmin())) return unauthorized()
  try {
    const service = createServiceClient()
    const body = await req.json().catch(() => ({}))
    if (body.stage === 'groups') {
      await refreshStoryGroups(service)
      return NextResponse.json({ ok: true })
    }
    const errors = await processPendingCandidates(service, 6)
    const pending = checked(
      await service
        .from('source_candidates')
        .select('id')
        .in('processing_status', ['pending', 'error'])
        .neq('status', 'dismissed')
        .lte('next_retry_at', new Date().toISOString())
        .limit(1)
    )
    return NextResponse.json({ action: pending?.length ? 'processed' : 'idle', errors })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
