import { getContentBadge, type ContentType } from '@/lib/contentTaxonomy'

export function ContentBadge({ contentType }: { contentType: ContentType }) {
  const { label, className } = getContentBadge(contentType)
  return <span className={`content-badge ${className}`}>{label}</span>
}
