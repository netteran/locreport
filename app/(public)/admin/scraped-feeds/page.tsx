'use client'
import { useEffect, useState, useCallback } from 'react'
import { ScrapedFeedWithStatus } from '@/lib/types'
import { ScrapedFeedForm } from '@/components/ScrapedFeedForm'
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

export default function ScrapedFeedsPage() {
  const [feeds, setFeeds] = useState<ScrapedFeedWithStatus[]>([])
  const [linking, setLinking] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editType, setEditType] = useState<'html' | 'rss'>('html')
  const [editUrl, setEditUrl] = useState('')
  const [editConfig, setEditConfig] = useState('')
  const [editKeywords, setEditKeywords] = useState('')
  const [editError, setEditError] = useState('')
  const [runAllResult, setRunAllResult] = useState<RunFeedResult | null>(null)
  const [rowResult, setRowResult] = useState<Record<string, string>>({})

  const load = useCallback(() => {
    fetch('/api/scraped-sources').then(r => r.json()).then(setFeeds)
  }, [])

  useEffect(() => { load() }, [load])

  async function toggle(feed: ScrapedFeedWithStatus) {
    await fetch(`/api/scraped-sources/${feed.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !feed.active }),
    })
    load()
  }

  // Creates the rss_sources row that makes ingest actually read this feed.
  async function addToSources(feed: ScrapedFeedWithStatus) {
    setLinking(feed.id)
    const res = await fetch(`/api/scraped-sources/${feed.id}/link`, { method: 'POST' })
    const data = await res.json().catch(() => ({}))
    setRowResult(prev => ({
      ...prev,
      [feed.id]: res.ok
        ? (data.already_linked ? 'Already in Sources.' : 'Added to Sources — ingest will read it from the next run.')
        : (data.error ?? 'Could not add to Sources.'),
    }))
    setLinking(null)
    load()
  }

  async function remove(id: string) {
    if (!confirm('Delete this feed? Its /api/feeds/<name> URL will start 404ing, and any Sources row pointing at it will stop returning items.')) return
    await fetch(`/api/scraped-sources/${id}`, { method: 'DELETE' })
    load()
  }

  function startEdit(feed: ScrapedFeedWithStatus) {
    setEditingId(feed.id)
    setEditName(feed.name)
    setEditType(feed.type)
    setEditUrl(feed.url)
    setEditKeywords((feed.keywords ?? []).join(', '))
    setEditConfig(JSON.stringify(fieldsToConfigJson(feed), null, 2))
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
      body: JSON.stringify({
        name: editName,
        type: editType,
        url: editUrl,
        keywords: editKeywords.split(',').map(k => k.trim()).filter(Boolean),
        ...configJsonToFields(config),
      }),
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

  const active = feeds.filter(f => f.active)
  const inactive = feeds.filter(f => !f.active)
  const unlinked = active.filter(f => !f.in_sources)

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2" style={{ color: 'var(--text)' }}>Feed Generator</h1>
      <p className="text-sm mb-4" style={{ color: 'var(--muted)' }}>
        Builds a feed for a site that doesn&apos;t publish a usable one — scraping an HTML listing page with
        CSS selectors, or re-filtering an existing feed by keyword — and publishes the result at{' '}
        <code className="text-xs">/api/feeds/&lt;name&gt;</code>. Every active feed is regenerated at the start
        of each scheduled ingest run (10am/1pm/5pm Warsaw, workdays), so ingest always reads XML that is
        seconds old.
      </p>
      <p className="text-sm mb-6 rounded-lg p-3" style={{ color: 'var(--text)', background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
        <strong>A feed on this page is not ingested until it is added to{' '}
        <a href="/admin/sources" className="underline underline-offset-2" style={{ color: 'var(--accent)' }}>Sources</a>.</strong>{' '}
        Ingest only reads Sources rows. Use <em>Add to Sources</em> on a feed once it is producing items —
        the row is created pointing at its <code className="text-xs">/api/feeds/&lt;name&gt;</code> URL, carrying
        over the ingest keywords set here.
      </p>

      {unlinked.length > 0 && (
        <div
          className="mb-6 rounded-lg p-3 text-sm"
          style={{ background: '#fefce8', border: '1px solid #fde68a', color: '#92400e' }}
        >
          {unlinked.length} active feed{unlinked.length !== 1 ? 's are' : ' is'} not in Sources yet, so nothing
          ingests {unlinked.length !== 1 ? 'them' : 'it'}: {unlinked.map(f => f.name).join(', ')}.
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-8">
        {/* Left: add form */}
        <div>
          <h2 className="text-sm font-medium uppercase tracking-wide mb-4" style={{ color: 'var(--muted)' }}>Add feed</h2>
          <ScrapedFeedForm onAdded={load} />
        </div>

        {/* Right: feed list */}
        <div className="flex flex-col gap-6">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
              Active feeds ({active.length})
            </h2>
            <RunFeedButton label="Run all now" onDone={r => { setRunAllResult(r); load() }} />
          </div>
          {runAllResult && (
            <p className="text-sm" style={{ color: runAllResult.failed > 0 ? 'var(--destructive, #e53e3e)' : 'var(--accent)' }}>
              {describeRun(runAllResult)}
            </p>
          )}

          <div className="flex flex-col gap-3">
            {active.map(feed => (
              <Card key={feed.id} className="p-4">
                {editingId === feed.id ? (
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
                    <Input value={editUrl} onChange={e => setEditUrl(e.target.value)} placeholder="URL to scrape" />
                    <Input
                      value={editKeywords}
                      onChange={e => setEditKeywords(e.target.value)}
                      placeholder="Ingest keywords, comma-separated (optional)"
                    />
                    <Textarea rows={8} value={editConfig} onChange={e => setEditConfig(e.target.value)} className="font-mono text-xs" />
                    {editError && <p className="text-sm text-red-600">{editError}</p>}
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => saveEdit(feed.id)}>Save</Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium text-sm" style={{ color: 'var(--text)' }}>{feed.name}</p>
                        <span
                          className="text-xs font-mono px-1.5 py-0.5 rounded"
                          style={{ background: 'var(--bg-secondary)', color: 'var(--muted)', border: '1px solid var(--border)' }}
                        >
                          {feed.type}
                        </span>
                        {/* Whether ingest can actually see this feed */}
                        {feed.in_sources ? (
                          <span
                            className="text-xs px-1.5 py-0.5 rounded"
                            style={feed.source_active
                              ? { background: '#dcfce7', color: '#166534', border: '1px solid #86efac' }
                              : { background: 'var(--bg-secondary)', color: 'var(--muted)', border: '1px solid var(--border)' }}
                          >
                            {feed.source_active ? 'in Sources' : 'in Sources (disabled)'}
                          </span>
                        ) : (
                          <span
                            className="text-xs px-1.5 py-0.5 rounded"
                            style={{ background: '#fefce8', color: '#92400e', border: '1px solid #fde68a' }}
                          >
                            not in Sources
                          </span>
                        )}
                        {/* A feed that generates nothing is the silent failure case */}
                        {feed.last_status === 'success' && (feed.last_item_count ?? 0) === 0 && (
                          <span
                            className="text-xs px-1.5 py-0.5 rounded"
                            style={{ background: '#fee2e2', color: '#991b1b', border: '1px solid #fca5a5' }}
                          >
                            0 items
                          </span>
                        )}
                      </div>
                      <p className="text-xs truncate" style={{ color: 'var(--muted)' }}>{feed.url}</p>
                      <p className="text-xs mt-1 font-mono" style={{ color: 'var(--accent)' }}>/api/feeds/{feed.name}</p>
                      {(feed.keywords ?? []).length > 0 && (
                        <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
                          Ingest keywords: {(feed.keywords ?? []).join(', ')}
                        </p>
                      )}
                      <p className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
                        Last run: {relativeTime(feed.last_run_at)}
                        {feed.last_status === 'success' && ` · ${feed.last_item_count ?? 0} item(s)`}
                        {feed.last_status === 'error' && ` · error: ${feed.last_error}`}
                      </p>
                      {rowResult[feed.id] && (
                        <p className="text-xs mt-1" style={{ color: 'var(--accent)' }}>{rowResult[feed.id]}</p>
                      )}
                    </div>
                    <div className="flex gap-2 flex-wrap shrink-0 items-center">
                      <RunFeedButton
                        label="Run now"
                        sourceId={feed.id}
                        onDone={r => { setRowResult(prev => ({ ...prev, [feed.id]: describeRun(r) })); load() }}
                      />
                      {!feed.in_sources && (
                        <Button size="sm" onClick={() => addToSources(feed)} disabled={linking === feed.id}>
                          {linking === feed.id ? 'Adding…' : 'Add to Sources'}
                        </Button>
                      )}
                      <Button size="sm" variant="secondary" onClick={() => startEdit(feed)}>Edit</Button>
                      <Button size="sm" variant="secondary" onClick={() => toggle(feed)}>Disable</Button>
                      <Button size="sm" variant="danger" onClick={() => remove(feed.id)}>Delete</Button>
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
                {inactive.map(feed => (
                  <Card key={feed.id} className="p-3 opacity-50">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="font-medium text-sm" style={{ color: 'var(--text)' }}>{feed.name}</p>
                        <p className="text-xs truncate" style={{ color: 'var(--muted)' }}>{feed.url}</p>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <Button size="sm" variant="secondary" onClick={() => toggle(feed)}>Enable</Button>
                        <Button size="sm" variant="danger" onClick={() => remove(feed.id)}>Delete</Button>
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
