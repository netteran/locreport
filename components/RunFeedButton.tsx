'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'

export type RunFeedResult = {
  processed: number
  succeeded: number
  failed: number
  results: { name: string; status: 'success' | 'error'; itemCount?: number; error?: string }[]
}

interface Props {
  label: string
  sourceId?: string // omitted = run every active source
  onDone?: (result: RunFeedResult) => void
}

// Triggers /api/scraped-sources/run — the same endpoint Vercel Cron calls on
// its daily schedule (see vercel.json). No confirm step: unlike ingest this
// doesn't create drafts, it only refreshes generated_xml + status fields.
export function RunFeedButton({ label, sourceId, onDone }: Props) {
  const [running, setRunning] = useState(false)

  async function run() {
    setRunning(true)
    try {
      const qs = sourceId ? `?id=${sourceId}` : ''
      const res = await fetch(`/api/scraped-sources/run${qs}`, { method: 'POST' })
      const data: RunFeedResult = await res.json()
      onDone?.(data)
    } catch {
      onDone?.({ processed: 0, succeeded: 0, failed: 1, results: [{ name: sourceId ?? 'all', status: 'error', error: 'Request failed' }] })
    } finally {
      setRunning(false)
    }
  }

  return (
    <Button size="sm" variant="secondary" onClick={run} disabled={running}>
      {running ? 'Running…' : label}
    </Button>
  )
}
