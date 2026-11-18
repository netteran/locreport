import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, unauthorized, requireResearchSchema } from '@/lib/adminAuth'
import { createServiceClient } from '@/lib/supabase/server'
import { checked } from '@/lib/research'
import { singleSourceMigrationProblem } from '@/lib/researchSchema'
import { EDITORIAL_DIRECTION_LIMIT } from '@/lib/compositionBrief'

export async function POST(req: NextRequest) {
  const user = await requireAdmin()
  if (!user) return unauthorized()
  try {
    const body = await req.json()
    if ('angle' in body && (typeof body.angle !== 'string' || body.angle.length > EDITORIAL_DIRECTION_LIMIT))
      return NextResponse.json({ error: `Editorial direction must be text within ${EDITORIAL_DIRECTION_LIMIT} characters` }, { status: 400 })
    const ids = [...new Set<string>(Array.isArray(body.candidate_ids) ? body.candidate_ids : [])]
    if (ids.length < 1 || ids.length > 8)
      return NextResponse.json({ error: 'Select 1–8 source candidates' }, { status: 400 })
    const id = randomUUID()
    const service = createServiceClient()
    const schemaResponse = await requireResearchSchema(service)
    if (schemaResponse) return schemaResponse
    const reservation = await service.rpc('reserve_composition', { p_id: id, p_candidates: ids, p_user: user.id })
    const migrationProblem = singleSourceMigrationProblem(reservation.error, ids.length)
    if (migrationProblem) return NextResponse.json({ error: migrationProblem }, { status: 503 })
    checked(reservation)
    if (typeof body.title === 'string' || typeof body.angle === 'string') {
      checked(
        await service
          .from('compositions')
          .update({
            title: String(body.title || '').slice(0, 250),
            angle: body.angle || ''
          })
          .eq('id', id)
      )
    }
    return NextResponse.json({ id }, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 409 })
  }
}
