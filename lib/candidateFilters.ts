import type { SourceCandidate } from './researchTypes'

export function publisherName(candidate: SourceCandidate): string {
  return candidate.source_name?.trim() || 'Unknown publisher'
}

export function filterCandidates(candidates: SourceCandidate[], filters: {
  status: string; query: string; publisher: string; dateFrom: string; dateTo: string; sort: string
}): SourceCandidate[] {
  const { status, publisher, dateFrom, dateTo, sort } = filters
  const query = filters.query.trim().toLowerCase()
  return candidates.filter(c => {
    const date = c.source_published_at?.slice(0, 10)
    return (status === 'all' || c.status === status) &&
      (!publisher || publisherName(c) === publisher) &&
      (!dateFrom || (!!date && date >= dateFrom)) &&
      (!dateTo || (!!date && date <= dateTo)) &&
      `${c.title} ${publisherName(c)} ${c.topics.join(' ')} ${c.entities.join(' ')}`.toLowerCase().includes(query)
  }).sort((a, b) => {
    if (sort === 'collected-desc') return b.created_at.localeCompare(a.created_at)
    // Keep undated sources last in either publication-date direction.
    if (!a.source_published_at) return b.source_published_at ? 1 : 0
    if (!b.source_published_at) return -1
    const difference = Date.parse(a.source_published_at) - Date.parse(b.source_published_at)
    return sort === 'published-asc' ? difference : -difference
  })
}
