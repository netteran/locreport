import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { listEpisodes, parsePodcastConfig } from '@/lib/podcast'

type Params = { params: Promise<{ id: string }> }

// Lists a podcast source's episodes and whether each already has a draft or
// article. Reads the feed only — spends no Gemini tokens.
export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params

  const session = await createClient()
  const { data: { user } } = await session.auth.getUser()
  if (!user || user.email !== process.env.ADMIN_EMAIL) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()
  const { data: source } = await supabase.from('rss_sources').select('*').eq('id', id).maybeSingle()
  if (!source || source.kind !== 'podcast') {
    return NextResponse.json({ error: 'Podcast source not found' }, { status: 404 })
  }
  const parsed = parsePodcastConfig(source.podcast_config)
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })

  let episodes
  try {
    episodes = await listEpisodes(source.url, parsed.config)
  } catch (err) {
    return NextResponse.json({ error: `Could not read feed: ${err instanceof Error ? err.message : String(err)}` }, { status: 502 })
  }

  const urls = [...new Set(episodes.flatMap(e => [e.link, e.youtubeUrl]).filter((u): u is string => !!u))]
  const [draftsRes, articlesRes] = await Promise.all([
    supabase.from('drafts').select('id, source_url, status').in('source_url', urls),
    supabase.from('articles').select('slug, source_url').in('source_url', urls),
  ])

  return NextResponse.json({
    episodes: episodes.slice(0, 25).map(e => {
      const mine = (u: string | null) => !!u && (u === e.link || u === e.youtubeUrl)
      const draft = (draftsRes.data ?? []).find(d => mine(d.source_url))
      const article = (articlesRes.data ?? []).find(a => mine(a.source_url))
      return {
        ...e,
        draft: draft ? { id: draft.id, status: draft.status } : null,
        article: article ? { slug: article.slug } : null,
      }
    }),
  })
}
