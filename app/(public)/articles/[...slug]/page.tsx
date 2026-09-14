import { notFound, redirect } from 'next/navigation'
import { createPublicClient } from '@/lib/supabase/server'
import AdminEditLink from '@/components/AdminEditLink'
import { cache } from 'react'
import { SITE_URL, ORG_ID, WEBSITE_ID, breadcrumbJsonLd } from '@/lib/seo'
import { marked } from 'marked'
import { Article, ARTICLE_COLUMNS } from '@/lib/types'
import { articleHref, estimateReadMinutes, safeImageUrl } from '@/lib/utils'
import { SIGNAL_MAP } from '@/lib/signals'
import { ShareButton } from '@/components/ShareButton'
import { SubscribeForm } from '@/components/SubscribeForm'
import Link from 'next/link'
import type { Metadata } from 'next'

export const revalidate = 86400

type Props = { params: Promise<{ slug: string[] }> }

const IMPACT_LABEL: Record<number, string> = { 1: 'Routine', 2: 'Notable', 3: 'Significant', 4: 'Major', 5: 'Disruptive' }

// Deduped per render pass: the page and generateMetadata both need the
// article, and without this each one issued its own set of lookups.
const fetchArticle = cache(async (slugParts: string[]) => {
  const supabase = createPublicClient()
  // Related reading passes this article's own vector to match_articles.
  const ARTICLE_WITH_EMBEDDING = `${ARTICLE_COLUMNS}, embedding`
  const joined = slugParts.join('/')
  const bare = slugParts[slugParts.length - 1]

  // A failed lookup must never be read as "no such article". Falling through
  // on error would 404 a live article — and ISR would then cache that 404.
  // Throwing instead keeps the last good render in place.
  const orThrow = <T,>({ data, error }: { data: T; error: { message: string } | null }) => {
    if (error) throw new Error(`article lookup failed for "${joined}": ${error.message}`)
    return data
  }

  const exact = orThrow(await supabase
    .from('articles').select(ARTICLE_WITH_EMBEDDING).eq('slug', joined).maybeSingle())
  if (exact) return { article: exact as unknown as Article, shouldRedirect: slugParts.length > 1 }

  const bySuffix = orThrow(await supabase
    .from('articles').select(ARTICLE_WITH_EMBEDDING).ilike('slug', `%/${bare}`).maybeSingle())
  if (bySuffix) return { article: bySuffix as unknown as Article, shouldRedirect: false }

  // Legacy URLs (pre-migration Jekyll permalinks, RSS-title truncation) sometimes carry a
  // slug that's a truncated/un-deduped prefix of the current one (slugify() cuts titles to
  // 80 chars and appends "-2", "-3", ... on collision). Redirect to the unique DB slug this
  // one is a prefix of, rather than 404ing on every retitle/dedup drift.
  const byPrefix = orThrow(await supabase
    .from('articles').select(ARTICLE_WITH_EMBEDDING).ilike('slug', `${bare}%`).limit(2))
  if (byPrefix?.length === 1) return { article: byPrefix[0] as unknown as Article, shouldRedirect: true }

  return null
})

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const result = await fetchArticle(slug)
  if (!result) return {}
  const { article: a } = result
  const canonicalSlug = a.slug.split('/').pop()
  // Only override the site-wide OG image when this article has its own.
  const image = safeImageUrl(a.image_url)
  return {
    title: a.title,
    description: a.excerpt ?? undefined,
    alternates: { canonical: `/articles/${canonicalSlug}` },
    ...(image ? { openGraph: { images: [{ url: image }] }, twitter: { images: [image] } } : {}),
  }
}

export default async function ArticlePage({ params }: Props) {
  const { slug } = await params
  const result = await fetchArticle(slug)
  if (!result) notFound()

  const { article, shouldRedirect } = result!

  if (shouldRedirect) {
    redirect(articleHref(article.slug))
  }

  const a = article as Article

  // Strip leading H1 — title is already rendered in the page header
  let content = a.content.replace(/^#\s+[^\n]+\n?/, '')
  // Strip leading blockquote (excerpt summary) that LLM includes at the top
  content = content.replace(/^\s*>[^\n]*(\n>[^\n]*)*/m, '').trimStart()

  const rawHtml = marked.parse(content) as string
  // Add target/_blank + rel=noopener to all external links in rendered content
  const html = rawHtml.replace(/<a (href="https?:\/\/)/g, '<a target="_blank" rel="noopener" $1')
  const date = new Date(a.published_at).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  })

  // Read time
  const readMinutes = estimateReadMinutes(content)

  // Optional lead image — absent unless an image URL was set on the article.
  const heroImage = safeImageUrl(a.image_url)
  const heroAlt = a.image_alt?.trim() || a.title

  // Resolve signal metadata
  const articleSignals = (a.signal_ids ?? [])
    .map(id => SIGNAL_MAP.get(id))
    .filter(Boolean) as NonNullable<ReturnType<typeof SIGNAL_MAP.get>>[]

  // Fetch related articles — semantic nearest-neighbors when this article has
  // an embedding, then shared-signal overlap, then recency as a final fill.
  const supabase = createPublicClient()
  let relatedArticles: Article[] = []
  if (a.embedding) {
    const { data: semantic } = await supabase.rpc('match_articles', {
      query_embedding: a.embedding,
      match_count: 5,
      exclude_id: a.id,
    })
    relatedArticles = (semantic as Article[]) ?? []
  }
  if (relatedArticles.length === 0 && articleSignals.length > 0) {
    const { data: related } = await supabase
      .from('articles')
      .select('id, title, slug, publisher, published_at, signal_ids')
      .neq('slug', a.slug)
      .overlaps('signal_ids', a.signal_ids)
      .order('published_at', { ascending: false })
      .limit(5)
    relatedArticles = (related as Article[]) ?? []
  }
  if (relatedArticles.length < 3) {
    const { data: recent } = await supabase
      .from('articles')
      .select('id, title, slug, publisher, published_at, signal_ids')
      .neq('slug', a.slug)
      .order('published_at', { ascending: false })
      .limit(5 - relatedArticles.length)
    const existingIds = new Set(relatedArticles.map(r => r.id))
    const extra = ((recent as Article[]) ?? []).filter(r => !existingIds.has(r.id))
    relatedArticles = [...relatedArticles, ...extra]
  }

  const hasIntel = !!a.impact_score || articleSignals.length > 0
    || a.business_implications?.length > 0 || a.affected_segments?.length > 0
  const hasRelated = relatedArticles.length > 0

  const articleUrl = `https://locreport.com/articles/${a.slug.split('/').pop()}`

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: a.title,
    description: a.excerpt ?? undefined,
    url: articleUrl,
    datePublished: a.published_at,
    dateModified: a.updated_at ?? a.published_at,
    author: a.author ? { '@type': 'Person', name: a.author } : { '@type': 'Organization', name: 'LocReport' },
    publisher: { '@id': ORG_ID },
    isPartOf: { '@id': WEBSITE_ID },
    image: heroImage ? new URL(heroImage, SITE_URL).toString() : 'https://locreport.com/og-image.jpg',
    mainEntityOfPage: { '@type': 'WebPage', '@id': articleUrl },
  }

  const breadcrumbLd = breadcrumbJsonLd([
    { name: 'Home', url: `${SITE_URL}/` },
    { name: 'Articles', url: `${SITE_URL}/articles` },
    { name: a.title },
  ])

  return (
    <div className="container">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }}
      />
      <article className="post">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <ol>
            <li><Link href="/">Home</Link></li>
            <li><Link href="/articles">Articles</Link></li>
            <li aria-current="page">{a.title}</li>
          </ol>
        </nav>

        <header className="post-header">
          <h1>{a.title}</h1>

          <div className="post-meta-row">
            <p className="post-meta">
              {a.author && <><span className="post-author">{a.author}</span> · </>}
              {date}<span className="read-time"> · {readMinutes} min read</span>
            </p>
            <div className="post-meta-actions">
              <AdminEditLink articleId={a.id} />
              <ShareButton title={a.title} url={articleUrl} />
            </div>
          </div>
        </header>

        {heroImage && (
          <figure className="post-hero">
            {/* Arbitrary external hosts — plain <img> avoids routing every
                publisher's CDN through the Next image optimizer. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={heroImage} alt={heroAlt} loading="eager" decoding="async" />
          </figure>
        )}

        <div className="post-content" dangerouslySetInnerHTML={{ __html: html }} />

        {/* ── Below the article, in order: Intelligence, newsletter,
            Related Reading, support. No sidebar — everything shares the
            article's own reading width. ── */}
        {hasIntel && (
          <section className="post-intel" aria-label="Article intelligence">
            <h2 className="post-section-label">Intelligence</h2>
            <div className="post-intel__badges">
              {a.impact_score && (
                <span className={`impact-badge impact-badge--${a.impact_score}`}>
                  {IMPACT_LABEL[a.impact_score]}
                </span>
              )}
              {a.time_horizon && (
                <span className={`time-horizon-badge time-horizon-badge--${a.time_horizon}`}>
                  {a.time_horizon === 'now' ? 'Immediate' : a.time_horizon === '6months' ? '6-Month Horizon' : 'Long-Term'}
                </span>
              )}
              {articleSignals.map(s => (
                <Link key={s.id} href={`/intelligence/signals/${s.id}`} className="post-intel__signal">
                  {s.title}
                </Link>
              ))}
            </div>
            {a.business_implications?.length > 0 && (
              <div className="post-intel__implications">
                <p className="post-intel__sublabel">Why this matters</p>
                <ul className="post-intel__list">
                  {a.business_implications.map((imp, i) => <li key={i}>{imp}</li>)}
                </ul>
              </div>
            )}
            {a.affected_segments?.length > 0 && (
              <div className="intelligence-segments post-intel__segments">
                {a.affected_segments.map(seg => (
                  <span key={seg} className="segment-tag" data-segment={seg}>{seg}</span>
                ))}
              </div>
            )}
          </section>
        )}

        <div className="post-subscribe">
          <p className="post-subscribe__title">Get stories like this in your inbox</p>
          <SubscribeForm compact />
        </div>

        {hasRelated && (
          <section className="post-related" aria-label="Related reading">
            <h2 className="post-section-label">Related Reading</h2>
            <div className="post-related__grid">
              {relatedArticles.map(r => (
                <Link key={r.id} href={articleHref(r.slug)} className="post-related__card">
                  <span className="post-related__card-title">{r.title}</span>
                  <span className="post-related__card-date">
                    {new Date(r.published_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}

        <div className="support-box">
          <div className="support-box__inner">
            <div className="support-box__copy">
              <p className="support-box__headline">Keep independent coverage alive.</p>
              <p className="support-box__text">No ads. No paywall. No corporate backing. Just sharp, weekly intelligence on the language industry — free, because it should be.</p>
            </div>
            <div className="support-box__actions">
              <a href="https://buymeacoffee.com/locreport" target="_blank" rel="noopener" className="support-box__btn">
                Support LocReport →
              </a>
              <a href={`https://twitter.com/intent/tweet?url=https://locreport.com${articleHref(a.slug)}&text=${encodeURIComponent(a.title)}`} target="_blank" rel="noopener" className="support-box__share">
                Share this article
              </a>
            </div>
          </div>
        </div>
      </article>
    </div>
  )
}
