import type { IngestSourceResult } from '@/lib/ingestReport'

export function IngestDetails({ sources }: { sources: IngestSourceResult[] }) {
  if (!sources.length) return <p className="text-xs" style={{ color: 'var(--muted)' }}>No active RSS sources selected.</p>
  return <details className="text-xs" style={{ color: 'var(--muted)' }}>
    <summary className="cursor-pointer">Collection details · {sources.length} source{sources.length === 1 ? '' : 's'} · {sources.reduce((sum, source) => sum + source.items, 0)} feed entries</summary>
    <ul className="mt-2 space-y-3">
      {sources.map(source => {
        const reasons = [
          source.old && `${source.old} older than 30 days`, source.invalid && `${source.invalid} invalid dates or links`,
          source.seen && `${source.seen} previously collected`, source.keyword_misses && `${source.keyword_misses} outside keywords`,
          source.short_text && `${source.short_text} text too short`, source.unusable && `${source.unusable} unusable content`,
          source.failed && `${source.failed} processing errors`, source.deferred && `${source.deferred} unexamined; run again to continue`
        ].filter(Boolean)
        return <li key={source.id} className="break-words">
          <strong>{source.name}</strong> · {source.items} entries · {source.collected} collected
          {source.error && <p style={{ color: 'var(--destructive, #e53e3e)' }}>{source.error}</p>}
          {reasons.length > 0 && <p>{reasons.join(' · ')}</p>}
          {source.rejections.length > 0 && <ul className="mt-1 space-y-1">
            {source.rejections.map((item, index) => <li key={index}>
              <a className="underline" href={item.url} target="_blank" rel="noopener noreferrer">{item.url}</a>
              {' '}— {item.reason === 'short_text' ? 'text too short' : 'unusable content'}
            </li>)}
          </ul>}
        </li>
      })}
    </ul>
  </details>
}
