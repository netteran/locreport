'use client'

import Link from 'next/link'
import { Fragment, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { ContentBadge } from './ContentBadge'
import { HomeFeedAd } from './HomeFeedAd'
import { CONTENT_TYPES, CONTENT_TAXONOMY, type ContentFilter, type ContentType } from '@/lib/contentTaxonomy'
import type { FeedPage, FeedPost } from '@/lib/contentFeed'
import { feedPageFromPath, feedPagePath, type FeedCursor } from '@/lib/feedPagination'
import { SITE_URL } from '@/lib/seo'

const FILTERS: ContentFilter[] = ['all', ...CONTENT_TYPES]
const pubDate = new Intl.DateTimeFormat('en-GB', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })

async function fetchPage(page: number, type: ContentFilter, signal: AbortSignal, before?: FeedCursor): Promise<FeedPage> {
  const params = new URLSearchParams({ page: String(page), type })
  if (before) {
    params.set('before', before.publishedAt)
    params.set('id', before.id)
  }
  const response = await fetch(`/api/content/feed?${params}`, { signal })
  if (!response.ok) throw new Error('Could not load the stories. Please try again.')
  return response.json()
}

function normalClick(event: MouseEvent<HTMLAnchorElement>) {
  return !(event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
}

function updateCanonical(page: number) {
  const link = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')
  if (link) link.href = SITE_URL + feedPagePath(page)
}

function PostCard({ post }: { post: FeedPost }) {
  return (
    <article className="editorial-home__card">
      {post.imageUrl && (
        <Link href={post.href} className="editorial-home__card-image" aria-hidden="true" tabIndex={-1}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={post.imageUrl} alt="" width={640} height={360} loading="lazy" decoding="async" />
        </Link>
      )}
      <div className="editorial-home__card-copy">
        <div className="content-card-meta">
          <ContentBadge contentType={post.contentType} />
          <time dateTime={post.publishedAt}>{pubDate.format(new Date(post.publishedAt))}</time>
        </div>
        <h3><Link href={post.href}>{post.title}</Link></h3>
        {post.excerpt && <p>{post.excerpt}</p>}
        {post.author && <p className="editorial-home__card-author">{post.author}</p>}
      </div>
    </article>
  )
}

function LeadPost({ post }: { post: FeedPost | undefined }) {
  if (!post) return (
    <section className="editorial-home__lead">
      <h1>LocReport</h1>
      <p>Follow <Link href="/fact-flow">Fact Flow</Link> for the latest sourced news.</p>
    </section>
  )
  return (
    <article className="editorial-home__lead" aria-label="Latest story">
      <div className="editorial-home__lead-copy">
        <p className="editorial-home__label"><ContentBadge contentType={post.contentType} /></p>
        <h1><Link href={post.href}>{post.title}</Link></h1>
        {post.excerpt && <p className="editorial-home__summary">{post.excerpt}</p>}
        <p className="editorial-home__byline">
          {post.author && <>{post.author} · </>}
          <time dateTime={post.publishedAt}>{pubDate.format(new Date(post.publishedAt))}</time>
        </p>
        <Link className="editorial-home__read" href={post.href}>Read the {post.contentType}</Link>
      </div>
      {post.imageUrl && (
        <Link className="editorial-home__image" href={post.href} aria-hidden="true" tabIndex={-1}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={post.imageUrl} alt="" width={1120} height={700} fetchPriority="high" />
        </Link>
      )}
    </article>
  )
}

type Props = {
  initial: FeedPage
  archiveType?: ContentType
  companion?: ReactNode
}

export function ContentFeed({ initial, archiveType, companion }: Props) {
  const [filter, setFilter] = useState<ContentFilter>(archiveType ?? 'all')
  const [feed, setFeed] = useState(initial)
  const [pending, setPending] = useState<ContentFilter | 'more' | null>(null)
  const [error, setError] = useState('')
  const activeRequest = useRef<AbortController | null>(null)
  const snapshots = useRef(new Map([[initial.page, initial]]))
  const initialPage = initial.page

  useEffect(() => {
    if (archiveType) return () => activeRequest.current?.abort()
    function restorePage() {
      const page = feedPageFromPath(window.location.pathname)
      if (page === null) return
      const snapshot = snapshots.current.get(page)
      if (!snapshot) return
      activeRequest.current?.abort()
      setPending(null)
      setError('')
      setFilter('all')
      setFeed(snapshot)
      updateCanonical(page)
    }
    window.addEventListener('popstate', restorePage)
    return () => {
      window.removeEventListener('popstate', restorePage)
      activeRequest.current?.abort()
    }
  }, [archiveType])

  async function changeFilter(event: MouseEvent<HTMLAnchorElement>, type: ContentFilter) {
    if (!normalClick(event)) return
    event.preventDefault()
    activeRequest.current?.abort()
    if (type === filter) {
      setPending(null)
      return
    }
    setError('')
    const cached = type === 'all' && snapshots.current.get(feedPageFromPath(window.location.pathname) ?? initialPage)
    if (cached) {
      setFilter('all')
      setFeed(cached)
      setPending(null)
      return
    }
    const controller = new AbortController()
    activeRequest.current = controller
    setPending(type)
    try {
      const loaded = await fetchPage(1, type, controller.signal)
      if (controller.signal.aborted) return
      setFeed(loaded)
      setFilter(type)
    } catch {
      if (!controller.signal.aborted) setError('Could not switch the feed. Please try again.')
    } finally {
      if (activeRequest.current === controller) {
        activeRequest.current = null
        setPending(null)
      }
    }
  }

  async function loadMore() {
    if (pending || feed.nextPage === null || activeRequest.current && !activeRequest.current.signal.aborted) return
    const controller = new AbortController()
    activeRequest.current = controller
    setPending('more')
    setError('')
    try {
      const loaded = await fetchPage(feed.nextPage, filter, controller.signal, feed.posts.at(-1))
      if (controller.signal.aborted) return
      const seen = new Set(feed.posts.map(post => post.id))
      const combined = { ...loaded, posts: [...feed.posts, ...loaded.posts.filter(post => !seen.has(post.id))] }
      setFeed(combined)
      if (filter === 'all' && loaded.posts.length) {
        snapshots.current.set(loaded.page, combined)
        window.history.pushState(null, '', feedPagePath(loaded.page))
        updateCanonical(loaded.page)
      }
    } catch {
      if (!controller.signal.aborted) setError('Could not load more stories. Please try again.')
    } finally {
      if (activeRequest.current === controller) {
        activeRequest.current = null
        setPending(null)
      }
    }
  }

  const featured = initialPage === 1 && !archiveType
  const cards = featured ? feed.posts.slice(1) : feed.posts
  const hasAd = featured && filter === 'all' && cards.length > 3
  const showEmpty = !feed.posts.length && (!featured || filter !== 'all')

  return (
    <>
      {!archiveType && (
        <nav aria-label="Filter stories" className="content-filters">
          {FILTERS.map(type => (
            <a key={type} href={type === 'all' ? '/' : CONTENT_TAXONOMY[type].path}
              aria-current={filter === type ? 'true' : undefined}
              onClick={event => changeFilter(event, type)}>
              {type === 'all' ? 'All' : CONTENT_TAXONOMY[type].name}
            </a>
          ))}
        </nav>
      )}
      {featured && (
        <div className="editorial-home__opening">
          <LeadPost post={feed.posts[0]} />
          {companion}
        </div>
      )}
      <section className="editorial-home__below" aria-label="Stories" aria-busy={pending !== null}>
        {cards.length > 0 && (
          <>
            <div className="editorial-home__section-heading">
              <h2>{featured ? 'More stories' : 'Stories'}</h2>
            </div>
            <div className="editorial-home__analysis-grid">
              {cards.map((post, index) => (
                <Fragment key={post.id}>
                  <PostCard post={post} />
                  {hasAd && index === 2 && (
                    <div className="editorial-home__ad"><HomeFeedAd placement="home-briefing" /></div>
                  )}
                </Fragment>
              ))}
            </div>
          </>
        )}
        {showEmpty && <p>No stories in this category yet.</p>}
        {error && <p role="alert" className="content-feed-status">{error}</p>}
        {(feed.nextPage !== null || (!archiveType && initialPage > 1)) && (
          <nav className="content-pagination" aria-label="Feed pages">
            {!archiveType && initialPage > 1 && <Link href={feedPagePath(initialPage - 1)}>Previous Page</Link>}
            {feed.nextPage !== null && (filter === 'all' ? (
              <a href={feedPagePath(feed.nextPage)} className="btn btn--primary" aria-label="Next Page"
                aria-disabled={pending !== null || undefined} onClick={event => {
                  if (!normalClick(event)) return
                  event.preventDefault()
                  void loadMore()
                }}>{pending === 'more' ? 'Loading…' : 'Load More'}</a>
            ) : (
              <button type="button" className="btn btn--primary" onClick={loadMore} disabled={pending !== null}>
                {pending === 'more' ? 'Loading…' : 'Load More'}
              </button>
            ))}
          </nav>
        )}
        {featured && filter === 'all' && <HomeFeedAd placement={hasAd ? 'home-feed' : 'home-briefing'} />}
      </section>
    </>
  )
}
