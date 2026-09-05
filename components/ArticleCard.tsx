import Link from 'next/link'
import { Article } from '@/lib/types'
import { articleHref, extractTeaser, safeImageUrl } from '@/lib/utils'

const IMPACT_LABEL: Record<number, string> = { 1: 'Routine', 2: 'Notable', 3: 'Significant', 4: 'Major', 5: 'Disruptive' }
const CATEGORY_LABEL: Record<string, string> = {
  industry: 'Current news',
  'monthly-summary': 'Monthly report',
}

export function ArticleCard({ article, featured }: { article: Article; featured?: boolean }) {
  const date = new Date(article.published_at).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
  const thumb = safeImageUrl(article.image_url)

  if (featured) {
    return (
      <article className="article-row article-row--featured">
        {thumb && (
          <Link href={articleHref(article.slug)} className="article-row__hero" aria-hidden="true" tabIndex={-1}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={thumb} alt="" loading="lazy" decoding="async" />
          </Link>
        )}
        <div className="article-row__header">
          <span className="article-row__badge article-row__badge--latest">Latest</span>
          {article.impact_score && (
            <span className={`impact-badge impact-badge--${article.impact_score}`}>{IMPACT_LABEL[article.impact_score]}</span>
          )}
          <span className="article-row__date">{date}</span>
        </div>
        <h2 className="article-row__title"><Link href={articleHref(article.slug)}>{article.title}</Link></h2>
        <p className="article-row__excerpt">{article.excerpt || extractTeaser(article.content)}</p>
        <div className="article-row__footer">
          {article.author && <span className="article-row__publisher">{article.author}</span>}
          {article.article_type && CATEGORY_LABEL[article.article_type] && (
            <span className="article-card-category">{CATEGORY_LABEL[article.article_type]}</span>
          )}
          <Link className="article-row__read-more" href={articleHref(article.slug)}>Read more →</Link>
        </div>
      </article>
    )
  }

  return (
    <article className={`article-row${thumb ? ' article-row--with-thumb' : ''}`}>
      <div className="article-row__main">
        <div className="article-row__header">
          <span className="article-row__date">{date}</span>
          {article.impact_score && article.impact_score >= 3 && (
            <span className={`impact-dot impact-dot--${article.impact_score}`} title={`Impact: ${IMPACT_LABEL[article.impact_score]}`} />
          )}
        </div>
        <h2 className="article-row__title"><Link href={articleHref(article.slug)}>{article.title}</Link></h2>
        <p className="article-row__excerpt">{article.excerpt || extractTeaser(article.content)}</p>
        <div className="article-row__footer">
          {article.author && <span className="article-row__publisher">{article.author}</span>}
          {article.article_type && CATEGORY_LABEL[article.article_type] && (
            <span className="article-card-category">{CATEGORY_LABEL[article.article_type]}</span>
          )}
          <Link className="article-row__read-more" href={articleHref(article.slug)}>Read more →</Link>
        </div>
      </div>
      {thumb && (
        <Link href={articleHref(article.slug)} className="article-row__thumb" aria-hidden="true" tabIndex={-1}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={thumb} alt="" loading="lazy" decoding="async" />
        </Link>
      )}
    </article>
  )
}
