import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { revalidateArticleSurfaces } from '@/lib/revalidate'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.email !== process.env.ADMIN_EMAIL) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const service = createServiceClient()

  const { data: articles, error: fetchError } = await service
    .from('articles')
    .select('id, draft_id')

  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 })
  if (!articles?.length) return NextResponse.json({ updated: 0, message: 'No articles found' })

  // Fetch source_feed_id for all drafts linked to these articles
  const draftIds = articles.map(a => a.draft_id).filter(Boolean) as string[]
  const draftFeedMap = new Map<string, string | null>()

  if (draftIds.length) {
    const { data: drafts } = await service
      .from('drafts')
      .select('id, source_feed_id')
      .in('id', draftIds)
    for (const d of drafts ?? []) {
      draftFeedMap.set(d.id, d.source_feed_id)
    }
  }

  // RSS-originated articles → Industry Desk; everything else → Editorial Desk
  const updates: Array<{ id: string; author: string }> = []
  for (const article of articles) {
    const feedId = article.draft_id ? draftFeedMap.get(article.draft_id) : undefined
    const author = feedId
      ? 'LocReport Industry Desk'
      : 'LocReport Editorial Desk'
    updates.push({ id: article.id, author })
  }

  const results = await Promise.allSettled(
    updates.map(({ id, author }) =>
      service.from('articles').update({ author }).eq('id', id)
    )
  )

  const failed = results.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && r.value.error))
  const succeeded = updates.length - failed.length

  const breakdown = updates.reduce<Record<string, number>>((acc, { author }) => {
    acc[author] = (acc[author] ?? 0) + 1
    return acc
  }, {})

  // Bylines render in the listings, so the cached pages have to turn over.
  // Individual detail pages are left on their own 24h window — invalidating a
  // slug apiece would stampede regeneration across the whole archive.
  if (succeeded > 0) revalidateArticleSurfaces()

  return NextResponse.json({ updated: succeeded, failed: failed.length, breakdown })
}
