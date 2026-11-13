import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, isCronRequest, unauthorized, requireResearchSchema } from '@/lib/adminAuth'
import { createServiceClient } from '@/lib/supabase/server'
import { checked, pendingCandidatesQuery, processPendingCandidates, refreshStoryGroups } from '@/lib/research'

export const maxDuration = 300
export async function POST(req: NextRequest) {
  if (!isCronRequest(req) && !(await requireAdmin())) return unauthorized()
  try {
    const service = createServiceClient()
    const schemaResponse = await requireResearchSchema(service)
    if (schemaResponse) return schemaResponse
    const body = await req.json().catch(() => ({}))
    if (body.stage === 'groups') {
      await refreshStoryGroups(service)
      return NextResponse.json({ ok: true })
    }
    const sourceIds: string[] = body.source_ids ?? []
    if (!Array.isArray(sourceIds) || sourceIds.length > 500 || sourceIds.some(
      (id) => typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
    )) return NextResponse.json({ error: 'source_ids must be an array of source UUIDs' }, { status: 400 })
    const result = await processPendingCandidates(service, 6, sourceIds)
    const pending = checked(await pendingCandidatesQuery(service, sourceIds).limit(1))
    return NextResponse.json({ action: pending?.length ? 'processed' : 'idle', ...result })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
