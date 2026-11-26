import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { ContentFeed } from '@/components/ContentFeed'
import { loadContentFeed } from '@/lib/contentFeed'
import { feedPageNumber, feedPagePath } from '@/lib/feedPagination'

// Not invalidated on publish (that rewrote every page per publish). A day is the
// staleness bound for these offset-paged archive pages — see CLAUDE.md.
export const revalidate = 86400
export const dynamic = 'force-static'

export function generateStaticParams() {
  return []
}

type Props = { params: Promise<{ num: string }> }

const loadPage = cache(async (number: string) => {
  const page = feedPageNumber(number)
  if (page === null || page === 1) notFound()
  const feed = await loadContentFeed(page)
  if (!feed.posts.length) notFound()
  return feed
})

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { page } = await loadPage((await params).num)
  return {
    title: `Latest stories — Page ${page}`,
    alternates: { canonical: feedPagePath(page) },
  }
}

export default async function FeedPage({ params }: Props) {
  const feed = await loadPage((await params).num)
  return (
    <main className="editorial-home">
      <div className="editorial-home__inner">
        <header className="public-page-heading">
          <h1>Latest stories</h1>
          <p>Page {feed.page}</p>
        </header>
        <ContentFeed key={feed.page} initial={feed} />
      </div>
    </main>
  )
}
