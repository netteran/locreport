import { unclearCitations } from '@/lib/citationStyle'

export function CitationWordingNote({ content }: { content: string }) {
  const issues = unclearCitations(content)
  if (!issues.length) return null
  const labels = [...new Set(issues.map(issue => issue.label))].slice(0, 5)
  return <p role="note" className="mt-3 text-xs" style={{ color: 'var(--muted)', lineHeight: 1.6 }}>
    {issues.length} source link{issues.length === 1 ? ' has' : 's have'} unclear text ({labels.map(label => `“${label || 'empty link text'}”`).join(', ')}).
    {' '}Link the publisher, report name or relevant words in the sentence so readers can tell where it leads.
  </p>
}
