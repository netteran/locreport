'use client'
import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { ResearchRunStatus } from '@/components/ResearchProcessButton'
import { postResearchJson, runResearchPipeline, type ResearchRunResult } from '@/lib/manualResearch'

type IngestState = 'idle' | 'confirm' | 'running' | 'done' | 'error'
export type IngestResult = { processed: number; skipped: number; errors: string[]; research: ResearchRunResult }

interface Props {
  label: string
  sourceIds?: string[]   // empty/omitted = all active sources
  requireConfirm?: boolean
  confirmMessage?: string
  onDone?: (result: IngestResult) => void
  compact?: boolean
}

export function IngestButton({ label, sourceIds, requireConfirm, confirmMessage, onDone, compact }: Props) {
  const size = compact ? 'xs' : 'sm'
  const text = compact ? 'text-xs' : 'text-sm'
  const [state, setState] = useState<IngestState>('idle')
  const [result, setResult] = useState<IngestResult | null>(null)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')

  async function run() {
    setState('running')
    setResult(null)
    setError('')
    setProgress('Collecting source evidence…')
    try {
      const params = sourceIds?.length ? `?sources=${sourceIds.join(',')}` : ''
      const data = await postResearchJson(`/api/ingest${params}`)
      const research = await runResearchPipeline({ sourceIds, onProgress: setProgress })
      const result: IngestResult = {
        processed: data.processed ?? 0,
        skipped: data.skipped ?? 0,
        errors: data.errors ?? [],
        research
      }
      setResult(result)
      setState('done')
      onDone?.(result)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Collection failed')
      setState('error')
    }
  }

  function reset() {
    setState('idle')
    setResult(null)
  }

  if (state === 'confirm') {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className={text} style={{ color: 'var(--muted)' }}>
          {confirmMessage ?? 'Collect source evidence, process Fact Flow and refresh article suggestions? Eligible facts from Auto sources will publish.'}
        </span>
        <Button size={size} onClick={run}>Confirm</Button>
        <Button size={size} variant="ghost" onClick={reset}>Cancel</Button>
      </div>
    )
  }

  if (state === 'running') {
    return (
      <Button size={size} variant="secondary" disabled>
        <span className="animate-pulse">{progress}</span>
      </Button>
    )
  }

  if (state === 'done' && result) {
    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-3 flex-wrap">
          <span className={`${text} font-medium`} style={{ color: result.processed > 0 ? 'var(--accent)' : 'var(--muted)' }}>
            {result.processed > 0
              ? `+${result.processed} source candidate${result.processed !== 1 ? 's' : ''} collected`
              : '0 fresh items'}
          </span>
          <Link
            href="/admin/candidates"
            className={`${text} underline underline-offset-2`}
            style={{ color: 'var(--accent)' }}
          >
            Review source candidates →
          </Link>
          <Button size={size} variant="ghost" onClick={reset}>↺</Button>
        </div>
        <ResearchRunStatus result={result.research} />
        {result.errors.length > 0 && (
          <details className="text-xs" style={{ color: 'var(--destructive, #e53e3e)' }}>
            <summary style={{ cursor: 'pointer' }}>{result.errors.length} error{result.errors.length !== 1 ? 's' : ''}</summary>
            <ul className="mt-1 space-y-0.5 pl-3">
              {result.errors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          </details>
        )}
      </div>
    )
  }

  if (state === 'error') {
    return (
      <div className="flex items-center gap-2">
        <span className={text} role="alert" style={{ color: 'var(--destructive, #e53e3e)' }}>{error}</span>
        <Button size={size} variant="ghost" onClick={reset}>↺</Button>
      </div>
    )
  }

  return (
    <Button size={size} variant="secondary" onClick={requireConfirm ? () => setState('confirm') : run}>
      {label}
    </Button>
  )
}
