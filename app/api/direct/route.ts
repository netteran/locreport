import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getOpenAI } from '@/lib/openai'
import { classifyArticle } from '@/lib/classify'
import { isContentType } from '@/lib/contentTaxonomy'
import { slugify, uniqueSlug } from '@/lib/slugify'
import { getDirectoryEntries, linkifyCompanyMentions } from '@/lib/companyLinks'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.email !== process.env.ADMIN_EMAIL) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json()
  const { title, content, contentType = 'analysis', sourceUrl, sourceName, extraUrl1, extraSourceName1, extraUrl2, extraSourceName2 } = body

  if (!title?.trim() || !content?.trim()) {
    return NextResponse.json({ error: 'title and content are required' }, { status: 400 })
  }

  if (!isContentType(contentType) || contentType === 'report') {
    return NextResponse.json({ error: 'Choose brief or analysis. Create reports in the monthly reporting workspace.' }, { status: 400 })
  }

  const sources = [
    sourceUrl?.trim() ? { url: sourceUrl.trim(), name: sourceName?.trim() || null } : null,
    extraUrl1?.trim() ? { url: extraUrl1.trim(), name: extraSourceName1?.trim() || null } : null,
    extraUrl2?.trim() ? { url: extraUrl2.trim(), name: extraSourceName2?.trim() || null } : null,
  ].filter(Boolean) as { url: string; name: string | null }[]

  if (contentType === 'brief' && sources.length !== 1) {
    return NextResponse.json({ error: 'An industry brief needs one original source.' }, { status: 400 })
  }
  const primarySourceUrl = sources[0]?.url ?? null
  const classification = await classifyArticle(getOpenAI(), content)

  const db = createServiceClient()
  const slug = await uniqueSlug(slugify(title.trim()), 'drafts', db)
  const directoryEntries = await getDirectoryEntries(db)
  const linkedContent = linkifyCompanyMentions(content, directoryEntries)
  const { data, error } = await db
    .from('drafts')
    .insert({
      title: title.trim(),
      slug,
      content: linkedContent,
      source_url: primarySourceUrl,
      content_type: contentType,
      status: 'pending',
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  return NextResponse.json({
    draft: data,
    classification,
    contentType,
    sources,
  }, { status: 201 })
}
