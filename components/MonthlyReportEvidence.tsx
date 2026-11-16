function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}
function text(value: unknown) { return typeof value === 'string' ? value : '' }
function sourceLink(value: unknown) {
  const url = text(value)
  return /^https?:\/\//.test(url) || url.startsWith('/articles/') ? url : null
}

export function MonthlyReportEvidence({ snapshot }: { snapshot: string | null }) {
  let context: Record<string, unknown>
  try { context = record(JSON.parse(snapshot || '{}').context) } catch { context = {} }
  const sections = [
    { key: 'articles', label: 'Published analysis', body: 'analysis' },
    { key: 'published_facts', label: 'Fact Flow', body: 'content' },
    { key: 'source_evidence', label: 'Source evidence', body: 'extracted_facts' }
  ]
  const previous = record(context.previous_briefing)
  return (
    <details className="mt-3">
      <summary className="cursor-pointer font-medium">Sources assessed for this briefing</summary>
      {sections.map(section => {
        const rows = context[section.key]
        return Array.isArray(rows) && rows.length > 0 && <section className="mt-3" key={section.key}>
          <h3 className="font-medium">{section.label}</h3>
          <ul className="mt-2 space-y-3">
            {rows.map((value, i) => {
              const row = record(value), title = text(row.title) || text(row.content), url = sourceLink(row.url || row.source_url)
              return <li key={i}>
                {url ? <a href={url} target="_blank" rel="noopener noreferrer" className="underline">{title}</a> : <span>{title}</span>}
                <p className="text-xs" style={{ color: 'var(--muted)' }}>{text(row.source_name || row.publisher)}{row.quality ? ` · ${text(row.quality)}` : ''}</p>
                {row.review_reason ? <p className="text-xs">Review note: {text(row.review_reason)}</p> : null}
                {section.body !== 'content' && <details className="mt-1 text-xs"><summary className="cursor-pointer">Read evidence</summary><p className="whitespace-pre-wrap mt-2">{text(row[section.body])}</p></details>}
              </li>
            })}
          </ul>
        </section>
      })}
      {sourceLink(previous.url) && <p className="mt-3">Earlier briefing used for comparison: <a href={sourceLink(previous.url)!} target="_blank" rel="noopener noreferrer" className="underline">{text(previous.title)}</a></p>}
    </details>
  )
}
