import { useId } from 'react'
import { Label } from '@/components/ui/label'
import { CONTENT_TAXONOMY, isContentType, type ContentType } from '@/lib/contentTaxonomy'

const guidance: Record<ContentType, string> = {
  brief: '200–450 words about one development. Link the original source in the lead, add two or three “Why this matters” bullets, and close with a source footnote.',
  analysis: 'Aim for 600–1,500+ words on what the evidence means for the market. Cite named sources in the body.',
  report: 'Recurring market coverage, benchmarks, and evidence-backed industry roundups.',
}

export function ContentTypeField({ value, onChange, disabled }: {
  value: ContentType
  onChange: (value: ContentType) => void
  disabled?: boolean
}) {
  const id = useId()
  return (
    <div>
      <Label htmlFor={id}>Editorial format</Label>
      <select id={id} value={value} disabled={disabled || value === 'report'} aria-describedby={`${id}-guidance`}
        onChange={event => { if (isContentType(event.target.value)) onChange(event.target.value) }}
        className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
        style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--text)' }}>
        <option value="brief">{CONTENT_TAXONOMY.brief.label}</option>
        <option value="analysis">{CONTENT_TAXONOMY.analysis.label}</option>
        {value === 'report' && <option value="report">{CONTENT_TAXONOMY.report.label}</option>}
      </select>
      <p id={`${id}-guidance`} className="mt-1 text-xs" style={{ color: 'var(--muted)' }}>{guidance[value]}</p>
    </div>
  )
}
