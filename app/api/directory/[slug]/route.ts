import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { DIRECTORY } from '@/lib/data/directory'
import { revalidateDirectorySurfaces } from '@/lib/revalidate'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('directory')
    .select('*')
    .eq('slug', slug)
    .single()

  if (!error && data) return NextResponse.json(data)

  const staticEntry = DIRECTORY.find(e => e.slug === slug)
  if (staticEntry) return NextResponse.json(staticEntry)

  return NextResponse.json({ error: 'Not found' }, { status: 404 })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const supabase = await createClient()
  const body = await req.json()

  // Drop unset fields so a blank form input can't null a NOT NULL column.
  const patch = Object.fromEntries(
    Object.entries(body).filter(([, v]) => v !== null && v !== undefined)
  )

  // Try the override row first. maybeSingle() so "no such row" is an empty
  // result rather than an error — that is the normal case for an entry that
  // still lives only in lib/data/directory.ts.
  const { data: updated, error: updateError } = await supabase
    .from('directory')
    .update(patch)
    .eq('slug', slug)
    .select()
    .maybeSingle()

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })
  if (updated) {
    // Both slugs: the form allows renaming, which leaves the old URL cached.
    revalidateDirectorySurfaces(slug, updated.slug)
    return NextResponse.json(updated)
  }

  // No override row yet: materialize one from the static entry with the
  // submitted fields applied on top, so editing a curated company works
  // without seeding the whole table first.
  const base = DIRECTORY.find(e => e.slug === slug)
  if (!base) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { id: _ignored, ...seed } = base
  const { data: inserted, error: insertError } = await supabase
    .from('directory')
    .insert([{ ...seed, ...patch, slug }])
    .select()
    .single()

  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 })

  revalidateDirectorySurfaces(slug, inserted.slug)
  return NextResponse.json(inserted)
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const supabase = await createClient()

  const { error } = await supabase.from('directory').delete().eq('slug', slug)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Dropping an override row makes the static entry render again — still a change.
  revalidateDirectorySurfaces(slug)
  return NextResponse.json({ ok: true })
}
