import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { loadWeeklyNote, normalizeWeeklyNote, weeklyEditionDate, missingWeeklyNotes, WEEKLY_NOTE_MIGRATION } from '@/lib/email/weeklyNote'

async function isAdmin() {
  const client = await createClient()
  const { data: { user } } = await client.auth.getUser()
  return !!user && user.email === process.env.ADMIN_EMAIL
}

export async function GET() {
  if (!(await isAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    return NextResponse.json(await loadWeeklyNote(createServiceClient()), {
      headers: { 'Cache-Control': 'no-store' }
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not load paragraph' }, { status: 503 })
  }
}

export async function PUT(req: NextRequest) {
  if (!(await isAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let body: { paragraph?: unknown; editionDate?: unknown }
  let paragraph: string
  try {
    body = await req.json()
    paragraph = normalizeWeeklyNote(body?.paragraph)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid paragraph' }, { status: 400 })
  }
  const editionDate = weeklyEditionDate()
  if (body.editionDate !== editionDate) {
    return NextResponse.json({ error: 'The weekly edition has changed. Reload the paragraph before saving.' }, { status: 409 })
  }
  const { error } = await createServiceClient().from('weekly_newsletter_notes').upsert({
    edition_date: editionDate, paragraph, updated_at: new Date().toISOString()
  }, { onConflict: 'edition_date' })
  if (error) {
    return NextResponse.json({ error: missingWeeklyNotes(error)
      ? `Apply Supabase migration ${WEEKLY_NOTE_MIGRATION} to edit the newsletter paragraph.`
      : error.message }, { status: 503 })
  }
  return NextResponse.json({ editionDate, paragraph })
}
