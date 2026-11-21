import { canonicalLegacyArticleSlug } from './legacyArticleSlugs'
import { canonicalMonthlyReportSlug } from './monthlyReportSlugs'

export const CONTENT_TYPES = ['brief', 'analysis', 'report'] as const
export type ContentType = typeof CONTENT_TYPES[number]
export type ContentFilter = 'all' | ContentType

export const CONTENT_TAXONOMY = {
  brief: {
    path: '/briefs/',
    name: 'Briefs',
    section: 'Industry Briefs',
    label: 'INDUSTRY BRIEF',
    className: 'bg-blue-100 text-blue-800',
    description: 'Rapid updates on appointments, product releases, and events in localization.',
  },
  analysis: {
    path: '/analysis/',
    name: 'Analysis',
    section: 'Localization Analysis',
    label: 'LOC ANALYSIS',
    className: 'bg-purple-100 text-purple-800',
    description: 'In-depth reporting on localization technology and what industry changes mean for the market.',
  },
  report: {
    path: '/reports/',
    name: 'Reports',
    section: 'Industry Reports',
    label: 'MONTHLY REPORT',
    className: 'bg-emerald-100 text-emerald-800',
    description: 'Monthly industry roundups, benchmarks, and recurring market research.',
  },
} as const

export function isContentType(value: unknown): value is ContentType {
  return CONTENT_TYPES.some(type => type === value)
}

export type PostReference = {
  slug: string
  content_type?: ContentType | null
  article_type?: string | null
  content_slug?: string | null
}

export function getContentType(row: Pick<PostReference, 'content_type' | 'article_type'>): ContentType {
  if (row.article_type === 'monthly-summary') return 'report'
  return row.content_type ?? 'analysis'
}

export function articleSlug(post: PostReference): string {
  if (post.content_slug) return post.content_slug
  const slug = canonicalLegacyArticleSlug(post.slug.split('/').filter(Boolean).at(-1)?.toLowerCase() ?? '')
  return getContentType(post) === 'report' ? canonicalMonthlyReportSlug(slug) : slug
}

export function articleHref(post: PostReference): string {
  return `${CONTENT_TAXONOMY[getContentType(post)].path}${encodeURIComponent(articleSlug(post))}/`
}

export function getContentBadge(contentType: ContentType) {
  const { label, className } = CONTENT_TAXONOMY[contentType]
  return { label, className }
}

export function contentTypeFromPath(segment: string): ContentType | undefined {
  return CONTENT_TYPES.find(type => CONTENT_TAXONOMY[type].path === `/${segment}/`)
}

export function validSlugSegment(value: string) {
  return value.length <= 240 && /^[\p{L}\p{N}][\p{L}\p{N}_.-]*$/u.test(value)
}

export function isArticlePath(path: string): boolean {
  const parts = path.split('/').filter(Boolean)
  return parts.length === 2 && !!contentTypeFromPath(parts[0])
}
