'use client'
import { useEffect, useState, useCallback } from 'react'
import { ScrapedSource } from '@/lib/types'
import { ScrapedSourceForm } from '@/components/ScrapedSourceForm'
import { RunFeedButton, type RunFeedResult } from '@/components/RunFeedButton'
import { configJsonToFields, fieldsToConfigJson } from '@/lib/scrapedSourceConfig'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

function relativeTime(iso: string | null): string {
  if (!iso) return 'never'
  const ms = Date.now() - new Date(iso).getTime()
  const hours = Math.floor(ms / 3600_000)
  if (hours < 1) return 'less than an hour ago'
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export default function ScrapedSourcesPage() {
  const [sources, setSources] = useState<ScrapedSource[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editType, setEditType] = useState<'html' | 'rss'>('html')
  const [editUrl, setEditUrl] = useState('')
  const [editConfig, setEditConfig] = useState('')
  const [editError, setEditError] = useState('')
  const [runAllResult, setRunAllResult] = useState<RunFeedResult | null>(null)
  const [rowResult, setRowResult] = useState<Record<string, string>>({})

  const load = useCallback(() => {
    fetch('/api/scraped-sources').then(r => r.json()).then(setSources)
  }, [])

  useEffect(() => { load() }, [load])

  async function toggle(source: ScrapedSource) {
    await fetch(`/api/scraped-sources/${source.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !source.active }),
    })
    load()
  }

  async function remove(id: string) {
    if (!confirm('Delete this scrape source? The generated feed URL will start 404ing.')) return
    await fetch(`/api/scraped-sources/${id}`, { method: 'DELETE' })
    load()
  }

  function startEdit(source: ScrapedSource) {
    setEditingId(source.id)
    setEditName(source.name)
    setEditType(source.type)
    setEditUrl(source.url)
    setEditConfig(JSON.stringify(fieldsToConfigJson(source), null, 2))
    setEditError('')
  }

  async function saveEdit(id: string) {
    let config = {}
    if (editConfig.trim()) {
      try {
        config = JSON.parse(editConfig)
      } catch {
        setEditError('Config is not valid JSON.')
        return
      }
    }
    await fetch(`/api/scraped-sources/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: editName, type: editType, url: editUrl, ...configJsonToFields(config) }),
    })
    setEditingId(null)
    load()
  }

  function describeRun(result: RunFeedResult): string {
    const first = result.results[0]
    if (result.processed === 1 && first) {
      return first.status === 'success' ? `${first.itemCount ?? 0} item(s) generated.` : `Failed: ${first.error}`
    }
    return `${result.succeeded} succeeded, ${result.failed} failed.`
  }

  const active = sources.filter(s => s.active)
  const inactive = sources.filter(s => !s.active)

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2" style={{ color: 'var(--text)' }}>Feed Generator</h1>
      <p className="text-sm mb-6" style={{ color: 'var(--muted)' }}>
        Scrapes HTML listing pages or re-filters existing feeds by keyword, and publishes the result at{' '}
        <code className="text-xs">/api/feeds/&lt;name&gt;</code> — point an <a href="/admin/sources" className="underline underline-offset-2" style={{ color: 'var(--accent)' }}>RSS source</a>{' '}
        at that URL to feed it into the regular ingest pipeline. Runs automatically via Vercel Cron once a day
        (see vercel.json) — replaces the old aparasion/rss-generator GitHub repo, which needed hourly Actions runs
        that only mattered as often as ingest itself checks these sources (once a day).
      </p>

      <div className="grid md:grid-cols-2 gap-8">
        {/* Left: add form */}
        <div>
          <h2 className="text-sm font-medium uppercase tracking-wide mb-4" style={{ color: 'var(--muted)' }}>Add source</h2>
          <ScrapedSourceForm onAdded={load} />
        </div>

        {/* Right: source list */}
        <div className="flex flex-col gap-6">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
              Active sources ({active.length})
            </h2>
            <RunFeedButton label="Run all now" onDone={r => { setRunAllResult(r); load() }} />
          </div>
          {runAllResult && (
            <p className="text-sm" style={{ color: runAllResult.failed > 0 ? 'var(--destructive, #e53e3e)' : 'var(--accent)' }}>
              {describeRun(runAllResult)}
            </p>
          )}

          <div className="flex flex-col gap-3">
            {active.map(source => (
              <Card key={source.id} className="p-4">
                {editingId === source.id ? (
                  <div className="flex flex-col gap-2">
                    <Input value={editName} onChange={e => setEditName(e.target.value)} placeholder="Name" />
                    <select
                      value={editType}
                      onChange={e => setEditType(e.target.value as 'html' | 'rss')}
                      className="w-full rounded-lg border px-3 py-2 text-sm"
                      style={{ background: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--text)' }}
                    >
                      <option value="html">HTML listing page</option>
                      <option value="rss">Existing RSS/Atom feed</option>
                    </select>
                    <Input value={editUrl} onChange={e => setEditUrl(e.target.value)} placeholder="URL" />
                    <Textarea rows={8} value={editConfig} onChange={e => setEditConfig(e.target.value)} className="font-mono text-xs" />
                    {editError && <p className="text-sm text-red-600">{editError}</p>}
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => saveEdit(source.id)}>Save</Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium text-sm" style={{ color: 'var(--text)' }}>{source.name}</p>
                        <span
                          className="text-xs font-mono px-1.5 py-0.5 rounded"
                          style={{ background: 'var(--bg-secondary)', color: 'var(--muted)', border: '1px solid var(--border)' }}
                        >
                          {source.type}
                        </span>
                      </div>
                      <p className="text-xs truncate" style={{ color: 'var(--muted)' }}>{source.url}</p>
                      <p className="text-xs mt-1 font-mono" style={{ color: 'var(--accent)' }}>/api/feeds/{source.name}</p>
                      <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
                        Last run: {relativeTime(source.last_run_at)}
                        {source.last_status === 'success' && ` · ${source.last_item_count ?? 0} item(s)`}
                        {source.last_status === 'error' && ` · error: ${source.last_error}`}
                      </p>
                      {rowResult[source.id] && (
                        <p className="text-xs mt-1" style={{ color: 'var(--accent)' }}>{rowResult[source.id]}</p>
                      )}
                    </div>
                    <div className="flex gap-2 flex-wrap shrink-0 items-center">
                      <RunFeedButton
                        label="Run now"
                        sourceId={source.id}
                        onDone={r => { setRowResult(prev => ({ ...prev, [source.id]: describeRun(r) })); load() }}
                      />
                      <Button size="sm" variant="secondary" onClick={() => startEdit(source)}>Edit</Button>
                      <Button size="sm" variant="secondary" onClick={() => toggle(source)}>Disable</Button>
                      <Button size="sm" variant="danger" onClick={() => remove(source.id)}>Delete</Button>
                    </div>
                  </div>
                )}
              </Card>
            ))}
          </div>

          {inactive.length > 0 && (
            <div>
              <h3 className="text-xs font-medium uppercase tracking-wide mb-3" style={{ color: 'var(--muted)' }}>
                Disabled ({inactive.length})
              </h3>
              <div className="flex flex-col gap-2">
                {inactive.map(source => (
                  <Card key={source.id} className="p-3 opacity-50">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="font-medium text-sm" style={{ color: 'var(--text)' }}>{source.name}</p>
                        <p className="text-xs truncate" style={{ color: 'var(--muted)' }}>{source.url}</p>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <Button size="sm" variant="secondary" onClick={() => toggle(source)}>Enable</Button>
                        <Button size="sm" variant="danger" onClick={() => remove(source.id)}>Delete</Button>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
