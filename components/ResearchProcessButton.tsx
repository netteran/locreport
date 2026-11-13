'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { runResearchPipeline, researchRunSummary, type ResearchRunResult } from '@/lib/manualResearch'

export function ResearchRunStatus({ result }: { result: ResearchRunResult }) {
  return (
    <div className="text-xs space-y-1" role="status">
      <p>{researchRunSummary(result)}</p>
      {result.errors.length > 0 && (
        <details style={{ color: 'var(--destructive, #e53e3e)' }}>
          <summary>{result.errors.length} processing issue{result.errors.length === 1 ? '' : 's'}</summary>
          <ul className="pl-3">
            {result.errors.map((error, i) => <li key={i}>{error}</li>)}
          </ul>
        </details>
      )}
    </div>
  )
}

export function ResearchProcessButton({
  label = 'Process facts and suggestions', disabled, onDone
}: {
  label?: string
  disabled?: boolean
  onDone?: () => void | Promise<void>
}) {
  const [progress, setProgress] = useState('')
  const [result, setResult] = useState<ResearchRunResult | null>(null)
  const [error, setError] = useState('')

  async function run() {
    setResult(null)
    setError('')
    setProgress('Processing saved sources…')
    try {
      setResult(await runResearchPipeline({ onProgress: setProgress }))
      await onDone?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setProgress('')
    }
  }

  return (
    <div className="space-y-2">
      <Button variant="secondary" disabled={disabled || !!progress} onClick={run}>
        {progress || label}
      </Button>
      {result && <ResearchRunStatus result={result} />}
      {error && <p role="alert" className="text-red-600 text-sm">{error}</p>}
    </div>
  )
}
