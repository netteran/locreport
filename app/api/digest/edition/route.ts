import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/adminAuth'
import { createServiceClient } from '@/lib/supabase/server'
import { currentPeriod } from '@/lib/email/period'
import { buildIssue } from '@/lib/email/issue'
import { weeklyEditionDate } from '@/lib/email/weeklyNote'
import { loadEdition, normalizeEdition, issueMarkdown, editionRevision, linkedArticleIds, missingEditions, EDITION_MIGRATION } from '@/lib/email/edition'
import { editionCompanySlug } from '@/lib/email/editionCompany'
import { randomUUID } from 'node:crypto'

export async function GET(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const service = createServiceClient()
    const { periodStart, periodEnd } = currentPeriod()
    const editionDate = weeklyEditionDate(periodEnd)
    const saved = await loadEdition(service, editionDate)
    const refresh = req.nextUrl.searchParams.get('refresh') === '1'
    if (saved && !refresh) return NextResponse.json({ editionDate,
      subject: saved.subject, body_markdown: saved.body_markdown, saved: true, revision: editionRevision(saved, editionDate) }, { headers: { 'Cache-Control': 'no-store' } })
    const excluded = req.nextUrl.searchParams.get('exclude_company')
    const excludeSlug = excluded && /^[a-z0-9_-]{1,200}$/i.test(excluded)
      ? excluded : editionCompanySlug(saved?.body_markdown || '')
    const { issue, error } = await buildIssue(service, periodStart, periodEnd,
      refresh ? { seed: randomUUID(), excludeSlug } : undefined)
    if (error) throw new Error(error)
    return NextResponse.json({ editionDate, subject: issue?.topStory ? `The Weekly: ${issue.topStory.title}` : 'The Weekly from LocReport',
      body_markdown: issue ? issueMarkdown(issue) : '', saved: false, revision: saved ? editionRevision(saved, editionDate) : null }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 503 }) }
}
export async function PUT(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  let body, copy
  try { body = await req.json(); copy = normalizeEdition(body) }
  catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 400 }) }
  const date = weeklyEditionDate()
  if (body.editionDate !== date) return NextResponse.json({ error: 'The weekly edition changed. Reload before saving.' }, { status: 409 })
  try {
    const service = createServiceClient()
    const current = await loadEdition(service, date)
    if ((current ? editionRevision(current, date) : null) !== (body.revision || null)) return NextResponse.json({ error: 'This edition was changed in another tab. Reload before saving.' }, { status: 409 })
    const article_ids = await linkedArticleIds(service, copy.body_markdown)
    const { error } = await service.from('weekly_newsletter_editions').upsert({ edition_date: date, ...copy, article_ids, updated_at: new Date().toISOString() }, { onConflict: 'edition_date' })
    if (error) throw new Error(missingEditions(error) ? `Apply ${EDITION_MIGRATION} to enable full newsletter editing.` : error.message)
    return NextResponse.json({ editionDate: date, ...copy, saved: true, revision: editionRevision(copy, date) })
  } catch (error) { return NextResponse.json({ error: (error as Error).message }, { status: 503 }) }
}
