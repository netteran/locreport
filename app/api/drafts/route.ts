import { requireAdmin, unauthorized } from '@/lib/adminAuth'
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { slugify, uniqueSlug } from '@/lib/slugify'

export async function GET() {
  if (!await requireAdmin()) return unauthorized()
  const supabase = createServiceClient()
  const { data } = await supabase
    .from('drafts')
    .select('*')
    .eq('research_only', false)
    .order('created_at', { ascending: false })
  return NextResponse.json(data ?? [])
}

export async function POST(req: NextRequest) {
  if (!await requireAdmin()) return unauthorized()
  const { content, source_url, title: providedTitle } = await req.json()
  const titleMatch = content.match(/^#\s+(.+)$/m)
  const title = titleMatch?.[1]?.trim() || providedTitle?.trim() || 'Untitled'
  const supabase = createServiceClient()
  const slug = await uniqueSlug(slugify(title), 'drafts', supabase)
  const { data, error } = await supabase
    .from('drafts')
    .insert({ title, slug, content, source_url: source_url ?? null, status: 'pending' })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json(data, { status: 201 })
}

// Bulk status update
export async function PATCH(req: NextRequest) {
  if (!await requireAdmin()) return unauthorized()
  const { ids, status } = await req.json()
  if (!Array.isArray(ids) || !ids.length || !['pending','rejected'].includes(status)) {
    return NextResponse.json({ error: 'ids array and status required' }, { status: 400 })
  }
  const supabase = createServiceClient()
  const { error } = await supabase.from('drafts').update({ status }).in('id', ids)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

// Bulk delete drafts — does NOT touch seen_urls so ingest won't re-process them
export async function DELETE(req: NextRequest) {
  if (!await requireAdmin()) return unauthorized()
  const { ids } = await req.json()
  if (!Array.isArray(ids) || !ids.length) {
    return NextResponse.json({ error: 'ids array required' }, { status: 400 })
  }
  const supabase = createServiceClient()
  const { error } = await supabase.from('drafts').delete().in('id', ids)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
