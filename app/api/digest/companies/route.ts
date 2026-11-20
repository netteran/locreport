import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { fetchDirectoryEntries } from '@/lib/directory'
import { digestCompanyFromEntry } from '@/lib/email/digest'
import { companySectionMarkdown } from '@/lib/email/edition'
import { createServiceClient } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const entries = await fetchDirectoryEntries(createServiceClient())
  const slug = req.nextUrl.searchParams.get('slug')
  if (slug === null) {
    return NextResponse.json({
      companies: entries.map(({ slug, name }) => ({ slug, name })),
    }, { headers: { 'Cache-Control': 'no-store' } })
  }

  const entry = entries.find(company => company.slug === slug)
  if (!entry) return NextResponse.json({ error: 'That company is no longer in the directory.' }, { status: 404 })
  return NextResponse.json({
    section: companySectionMarkdown(digestCompanyFromEntry(entry)),
  }, { headers: { 'Cache-Control': 'no-store' } })
}
