import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, unauthorized } from '@/lib/adminAuth'
import { createServiceClient } from '@/lib/supabase/server'
import { checked } from '@/lib/research'
type Params = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  if (!(await requireAdmin())) return unauthorized()
  try {
    const { id } = await params
    const row = checked(
      await createServiceClient()
        .from('compositions')
        .select('*,composition_sources(*)')
        .eq('id', id)
        .single()
    )
    row.composition_sources.sort(
      (a: { position: number }, b: { position: number }) => a.position - b.position
    )
    return NextResponse.json(row)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 404 })
  }
}
export async function PATCH(req: NextRequest, { params }: Params) {
  if (!(await requireAdmin())) return unauthorized()
  try {
    const { id } = await params
    const b = await req.json()
    const service = createServiceClient()
    if (b.status === 'abandoned') {
      checked(await service.rpc('abandon_composition', { p_id: id }))
      return NextResponse.json({ ok: true })
    }
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if ('candidate_ids' in b) {
      if (!Array.isArray(b.candidate_ids)) throw new Error('candidate_ids must be an array')
      checked(
        await service.rpc('replace_composition_sources', {
          p_id: id,
          p_candidates: b.candidate_ids
        })
      )
    }
    for (const key of ['title', 'angle', 'personal_experience']) {
      if (key in b) {
        if (typeof b[key] !== 'string' || b[key].length > (key === 'title' ? 250 : 12000))
          throw new Error(`Invalid ${key}`)
        patch[key] = b[key]
      }
    }
    if ('target_words' in b) {
      if (!Number.isInteger(b.target_words) || b.target_words < 600 || b.target_words > 2400)
        throw new Error('Length must be 600–2400 words')
      patch.target_words = b.target_words
    }
    const row = checked(
      await service
        .from('compositions')
        .update(patch)
        .eq('id', id)
        .in('status', ['editing', 'ready', 'failed'])
        .select('*')
        .maybeSingle()
    )
    if (!row)
      return NextResponse.json(
        { error: 'Composition cannot be edited in its current state' },
        { status: 409 }
      )
    return NextResponse.json(row)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 })
  }
}
