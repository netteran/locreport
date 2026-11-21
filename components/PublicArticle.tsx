import { notFound, permanentRedirect } from 'next/navigation'
import { createPublicClient } from '@/lib/supabase/server'
import { DisplayAd } from '@/components/HomeFeedAd'
import { splitArticleForAd } from '@/lib/articleAd'
import AdminEditLink from '@/components/AdminEditLink'
import { cache } from 'react'
import { SITE_URL, ORG_ID, WEBSITE_ID, breadcrumbJsonLd, serializeJsonLd } from '@/lib/seo'
import { marked } from 'marked'
import { Article, ARTICLE_COLUMNS } from '@/lib/types'
import { estimateReadMinutes, safeImageUrl } from '@/lib/utils'
import { monthlyReportTitle, monthlyReportSubtitle, type BriefingCoverage } from '@/lib/briefingDisplay'
import { articleHref, CONTENT_TAXONOMY, getContentType, type ContentType } from '@/lib/contentTaxonomy'
import { resolvePublicArticle } from '@/lib/articleLookup'
import { withArticleReferences } from '@/lib/articleReferences'
import { presentBrief } from '@/lib/editorialProtocol'
import { ContentBadge } from './ContentBadge'
import { withOptionalBriefingCoverage } from '@/lib/briefingCoverage'
import { SIGNAL_MAP } from '@/lib/signals'
import { ShareButton } from '@/components/ShareButton'
import Link from 'next/link'
import type { Metadata } from 'next'


const fetchArticle = cache(async (slug: string, type: ContentType) => {
  const reference = await resolvePublicArticle([slug], type)
  if (!reference) return null

  const { data, error: articleError } = await createPublicClient().from('articles')
    .select(`${ARTICLE_COLUMNS}, embedding`).eq('id', reference.id).maybeSingle()
  if (articleError) throw new Error(`Article lookup failed: ${articleError.message}`)
  if (!data) return null
  const article = data as unknown as Article
  if (getContentType(article) !== 'report') return article

  const supabase = createPublicClient()
  const { data: coverage, error } = await withOptionalBriefingCoverage(columns => supabase
    .from('articles').select('id' + columns).eq('id', article.id)
    .returns<BriefingCoverage[]>().maybeSingle())
  if (error) throw new Error(`Monthly report coverage lookup failed: ${error.message}`)

  return {
    ...article,
    title: monthlyReportTitle({ ...coverage, title: article.title }),
    excerpt: monthlyReportSubtitle(article.excerpt),
  }
})

export async function articleMetadata(slug: string, contentType: ContentType): Promise<Metadata> {
  const a = await fetchArticle(slug, contentType)
  if (!a) return {}
  // Only override the site-wide OG image when this article has its own.
  const image = safeImageUrl(a.image_url)
  return {
    title: a.title,
    description: a.excerpt ?? undefined,
    alternates: { canonical: articleHref(a) },
    openGraph: { type: 'article', url: articleHref(a), ...(image ? { images: [{ url: image }] } : {}) },
    ...(image ? { twitter: { images: [image] } } : {}),
  }
}

export async function PublicArticle({ slug, contentType }: { slug: string; contentType: ContentType }) {
  const a = await fetchArticle(slug, contentType)
  if (!a) notFound()
  const path = articleHref(a)
  const taxonomy = CONTENT_TAXONOMY[getContentType(a)]
  if (path !== `${CONTENT_TAXONOMY[contentType].path}${encodeURIComponent(slug)}/`) permanentRedirect(path)

  // Strip leading H1; the article header already shows it.
  const content = a.content.replace(/^#\s+[^\n]+\n?/, '').trimStart()
  const body = contentType === 'brief' ? presentBrief(content, a.source_url, a.business_implications ?? []) : content
  const rawHtml = marked.parse(body) as string
  // Add target/_blank + rel=noopener to all external links in rendered content
  const html = rawHtml.replace(/<a (href="https?:\/\/)/g, '<a target="_blank" rel="noopener" $1')
  const articleParts = splitArticleForAd(html)
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
      .select('id, title, slug, publisher, published_at, signal_ids, article_type, content_type, content_slug')
      .neq('slug', a.slug)
      .overlaps('signal_ids', a.signal_ids)
      .order('published_at', { ascending: false })
      .limit(5)
    relatedArticles = (related as Article[]) ?? []
  }
  if (relatedArticles.length < 3) {
    const { data: recent } = await supabase
      .from('articles')
      .select('id, title, slug, publisher, published_at, signal_ids, article_type, content_type, content_slug')
      .neq('slug', a.slug)
      .order('published_at', { ascending: false })
      .limit(5 - relatedArticles.length)
    const existingIds = new Set(relatedArticles.map(r => r.id))
    const extra = ((recent as Article[]) ?? []).filter(r => !existingIds.has(r.id))
    relatedArticles = [...relatedArticles, ...extra]
  }

  relatedArticles = await withArticleReferences(supabase, relatedArticles)

  const hasImplications = contentType !== 'brief' && a.business_implications?.length > 0
  const hasRelated = relatedArticles.length > 0

  const articleUrl = `${SITE_URL}${path}`

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': contentType === 'brief' ? 'NewsArticle' : 'Article',
    articleSection: taxonomy.section,
    headline: a.title,
    description: a.excerpt ?? undefined,
    url: articleUrl,
    datePublished: a.published_at,
    dateModified: a.updated_at ?? a.published_at,
    author: a.author ? { '@type': a.author.includes('Desk') ? 'Organization' : 'Person', name: a.author } : { '@type': 'Organization', name: 'LocReport' },
    publisher: { '@id': ORG_ID },
    isPartOf: { '@id': WEBSITE_ID },
    image: heroImage ? new URL(heroImage, SITE_URL).toString() : 'https://locreport.com/og-image.jpg',
    mainEntityOfPage: { '@type': 'WebPage', '@id': articleUrl },
  }

  const breadcrumbLd = breadcrumbJsonLd([
    { name: 'Home', url: `${SITE_URL}/` },
    { name: taxonomy.name, url: `${SITE_URL}${taxonomy.path}` },
    { name: a.title },
  ])

  return (
    <main className="article-reading">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumbLd) }}
      />
      <article className="post">
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <ol>
            <li><Link href="/">Home</Link></li>
            <li><Link href={taxonomy.path}>{taxonomy.name}</Link></li>
            <li aria-current="page">{a.title}</li>
          </ol>
        </nav>

        <header className="post-header">
          <p className="article-reading__label"><ContentBadge contentType={contentType} /></p>
          <h1>{a.title}</h1>
          {a.excerpt && <p className="article-reading__deck">{a.excerpt}</p>}

          <div className="post-meta-row">
            <p className="post-meta">
              {a.author && <><span className="post-author">{a.author}</span> · </>}
              <time dateTime={a.published_at}>{date}</time><span className="read-time"> · {readMinutes} min read</span>
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

        {articleParts ? (
          <div className="post-content">
            <div dangerouslySetInnerHTML={{ __html: articleParts.before }} />
            <DisplayAd
              key={a.id}
              placement="article-inline"
            />
            <div dangerouslySetInnerHTML={{ __html: articleParts.after }} />
          </div>
        ) : (
          <div className="post-content" dangerouslySetInnerHTML={{ __html: html }} />
        )}

        {hasImplications && (
          <section className="post-intel" aria-labelledby="post-intel-heading">
            <h2 id="post-intel-heading">Why this matters</h2>
            <ul className="post-intel__list">
              {a.business_implications.map((imp, i) => <li key={i}>{imp}</li>)}
            </ul>
            {a.affected_segments?.length > 0 && (
              <div className="post-intel__segments">
                {a.affected_segments.map(seg => (
                  <span key={seg}>{seg}</span>
                ))}
              </div>
            )}
          </section>
        )}

        {hasRelated && (
          <section className="post-related" aria-label="Related reading">
            <h2 className="post-section-label">Related Reading</h2>
            <div className="post-related__grid">
              {relatedArticles.map(r => (
                <Link key={r.id} href={articleHref(r)} className="post-related__card">
                  <span className="post-related__card-title">{r.title}</span>
                  <span className="post-related__card-date">
                    {new Date(r.published_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}
      </article>
    </main>
  )
}
