import Link from 'next/link'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { Article } from '@/lib/types'
import { articleHref, extractTeaser, safeImageUrl } from '@/lib/utils'
import { SubscribeForm } from '@/components/SubscribeForm'

export const metadata: Metadata = {
  alternates: { canonical: '/' },
}

// Columns the homepage actually renders. Narrower than `Article` so the query
// skips `embedding` (a ~15-20KB serialized vector per row) and the metadata
// the editorial layout doesn't show.
type HomeArticle = Pick<
  Article,
  | 'id'
  | 'title'
  | 'slug'
  | 'excerpt'
  | 'content'
  | 'author'
  | 'image_url'
  | 'impact_score'
  | 'published_at'
>

const LEAD_POOL = 10   // newest N the lead story is chosen from, by impact
const STREAM_SIZE = 20 // articles listed below the lead

export const revalidate = 3600

function formatDate(iso: string, opts: Intl.DateTimeFormatOptions): string {
  return new Date(iso).toLocaleDateString('en-US', opts)
}

export default async function HomePage() {
  const supabase = await createClient()

  const { data } = await supabase
    .from('articles')
    .select('id, title, slug, excerpt, content, author, image_url, impact_score, published_at')
    .order('published_at', { ascending: false })
    .limit(STREAM_SIZE + 1)

  const articles = (data as HomeArticle[]) ?? []

  // Lead story: highest-impact of the newest few, so the top of the page isn't
  // purely chronological. Everything else runs newest-first underneath.
  const lead = [...articles.slice(0, LEAD_POOL)].sort(
    (a, b) => (b.impact_score ?? 0) - (a.impact_score ?? 0) || b.published_at.localeCompare(a.published_at)
  )[0]
  const stream = articles.filter(a => a.id !== lead?.id).slice(0, STREAM_SIZE)
  const leadImage = safeImageUrl(lead?.image_url)

  return (
    <div className="home">
      <div className="home-kicker">
        <div className="home-column home-kicker__shell">
          <span>Language services intelligence</span>
          {articles[0] && (
            <span>
              Updated {formatDate(articles[0].published_at, { year: 'numeric', month: 'long', day: 'numeric' })}
            </span>
          )}
        </div>
      </div>

      <main className="home-column">
        <h1 className="sr-only">LocReport — daily intelligence for the language services industry</h1>

        {lead && (
          <article className="home-lead">
            {leadImage && (
              <Link href={articleHref(lead.slug)} className="home-lead__media" aria-hidden="true" tabIndex={-1}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={leadImage} alt="" decoding="async" />
              </Link>
            )}
            <div className="home-meta">
              <span>{formatDate(lead.published_at, { year: 'numeric', month: 'short', day: 'numeric' })}</span>
              {lead.author && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{lead.author}</span>
                </>
              )}
            </div>
            <h2 className="home-lead__title">
              <Link href={articleHref(lead.slug)}>{lead.title}</Link>
            </h2>
            <p className="home-lead__dek">{lead.excerpt || extractTeaser(lead.content)}</p>
            <Link className="home-read-link" href={articleHref(lead.slug)}>Read the story →</Link>
          </article>
        )}

        <section className="home-stream" aria-label="Latest articles">
          {stream.map(article => {
            const thumb = safeImageUrl(article.image_url)
            return (
              <article key={article.id} className="home-row">
                <div className="home-row__main">
                  <h2 className="home-row__title">
                    <Link href={articleHref(article.slug)}>{article.title}</Link>
                  </h2>
                  <p className="home-row__dek">{article.excerpt || extractTeaser(article.content)}</p>
                  <div className="home-meta">
                    <span>{formatDate(article.published_at, { month: 'short', day: 'numeric' })}</span>
                    {article.author && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>{article.author}</span>
                      </>
                    )}
                  </div>
                </div>
                {thumb && (
                  <Link href={articleHref(article.slug)} className="home-row__thumb" aria-hidden="true" tabIndex={-1}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={thumb} alt="" loading="lazy" decoding="async" />
                  </Link>
                )}
              </article>
            )
          })}
        </section>

        <Link className="home-more" href="/articles">All articles →</Link>

        <section className="home-subscribe" aria-label="Subscribe to the digest">
          <p className="home-subscribe__copy">
            <strong>The industry, digested.</strong> One weekly email, impact-ranked. No noise.
          </p>
          <SubscribeForm compact />
        </section>
      </main>
    </div>
  )
}
