'use client'
import { useEffect, useState, useCallback } from 'react'
import { RssSource } from '@/lib/types'
import { SourceForm } from '@/components/SourceForm'
import { IngestButton } from '@/components/IngestButton'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

const BATCH_SIZE = 3
const AUTO_PUBLISH_COL_WIDTH = 'sm:w-[140px]'

type SourceWithStats = RssSource & { recent_drafts: number }

function groupIntoBatches<T>(arr: T[], size: number): T[][] {
  const batches: T[][] = []
  for (let i = 0; i < arr.length; i += size) batches.push(arr.slice(i, i + size))
  return batches
}

export default function SourcesPage() {
  const [sources, setSources] = useState<SourceWithStats[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editUrl, setEditUrl] = useState('')
  const [editKeywords, setEditKeywords] = useState('')

  const load = useCallback(() => {
    fetch('/api/sources').then(r => r.json()).then(setSources)
  }, [])

  useEffect(() => { load() }, [load])

  async function toggle(id: string, active: boolean) {
    await fetch(`/api/sources/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !active }),
    })
    load()
  }

  async function toggleAutoPublish(id: string, autoPublish: boolean) {
    await fetch(`/api/sources/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ auto_publish: !autoPublish }),
    })
    load()
  }

  async function remove(id: string) {
    if (!confirm('Delete this source?')) return
    await fetch(`/api/sources/${id}`, { method: 'DELETE' })
    load()
  }

  function startEdit(source: RssSource) {
    setEditingId(source.id)
    setEditName(source.name)
    setEditUrl(source.url)
    setEditKeywords((source.keywords ?? []).join(', '))
  }

  async function saveEdit(id: string) {
    const keywords = editKeywords.split(',').map(k => k.trim().toLowerCase()).filter(Boolean)
    await fetch(`/api/sources/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: editName, url: editUrl, keywords }),
    })
    setEditingId(null)
    load()
  }

  const activeSources = sources.filter(s => s.active)
  const inactiveSources = sources.filter(s => !s.active)
  const batches = groupIntoBatches(activeSources, BATCH_SIZE)

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6" style={{ color: 'var(--text)' }}>RSS Sources</h1>

      {/* Sources — full width so batches have room to breathe */}
      <div className="flex flex-col gap-6">
        <div className="flex items-center gap-3 px-1">
          <div className="min-w-0 sm:flex-1">
            <h2 className="text-sm font-medium uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
              Active sources ({activeSources.length}) · {batches.length} batch{batches.length !== 1 ? 'es' : ''}
            </h2>
          </div>
          <div className={`hidden sm:block sm:shrink-0 text-center text-xs font-medium uppercase tracking-wide ${AUTO_PUBLISH_COL_WIDTH}`} style={{ color: 'var(--muted)' }}>
            Auto publishing
          </div>
        </div>

        {batches.map((batch, batchIndex) => {
          const batchDrafts = batch.reduce((sum, s) => sum + s.recent_drafts, 0)
          return (
            <div key={batchIndex} className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)' }}>
              {/* Batch header */}
              <div className="flex items-center justify-between px-4 py-2" style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' }}>
                <div className="flex items-center gap-3">
                  <span className="text-xs font-mono font-semibold px-2 py-0.5 rounded" style={{ background: 'var(--accent-soft, var(--bg))', color: 'var(--accent)', border: '1px solid var(--accent)' }}>
                    Batch {batchIndex + 1}
                  </span>
                  <span className="text-xs" style={{ color: 'var(--muted)' }}>
                    {batch.length} source{batch.length !== 1 ? 's' : ''}
                    {batchDrafts > 0 && ` · ${batchDrafts} draft${batchDrafts !== 1 ? 's' : ''} (30d)`}
                  </span>
                </div>
                <IngestButton
                  label={`Ingest batch ${batchIndex + 1}`}
                  sourceIds={batch.map(s => s.id)}
                />
              </div>

              {/* Sources in batch */}
              <div className="flex flex-col divide-y" style={{ ['--tw-divide-opacity' as string]: '1', borderColor: 'var(--hairline, var(--border))' }}>
                {batch.map(source => (
                  <div key={source.id} className="px-4 py-3" style={{ background: 'var(--surface, var(--bg))' }}>
                    {editingId === source.id ? (
                      <div className="flex flex-col gap-2">
                        <Input value={editName} onChange={e => setEditName(e.target.value)} placeholder="Name" />
                        <Input value={editUrl} onChange={e => setEditUrl(e.target.value)} placeholder="URL" />
                        <Input value={editKeywords} onChange={e => setEditKeywords(e.target.value)} placeholder="Keywords (comma-separated)" />
                        <div className="flex gap-2">
                          <Button size="sm" onClick={() => saveEdit(source.id)}>Save</Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>Cancel</Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                        <div className="min-w-0 sm:flex-1">
                          <p className="font-medium text-sm" style={{ color: 'var(--text)' }}>{source.name}</p>
                          <p className="text-xs truncate" style={{ color: 'var(--muted)' }}>{source.url}</p>
                          {source.keywords?.length > 0 && (
                            <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
                              Keywords: {source.keywords.join(', ')}
                            </p>
                          )}
                          {source.recent_drafts > 0 && (
                            <p className="text-xs mt-0.5" style={{ color: 'var(--accent)' }}>
                              {source.recent_drafts} draft{source.recent_drafts !== 1 ? 's' : ''} (30d)
                            </p>
                          )}
                        </div>
                        <div className="flex gap-2 flex-wrap shrink-0 items-center">
                          <IngestButton label="Ingest" sourceIds={[source.id]} onDone={load} />
                          <Button size="sm" variant="secondary" onClick={() => startEdit(source)}>Edit</Button>
                          <Button size="sm" variant="secondary" onClick={() => toggle(source.id, source.active)}>Disable</Button>
                          <Button size="sm" variant="danger" onClick={() => remove(source.id)}>Delete</Button>
                        </div>
                        <div className={`flex items-center gap-2 sm:shrink-0 sm:justify-center ${AUTO_PUBLISH_COL_WIDTH}`}>
                          <input
                            type="checkbox"
                            checked={source.auto_publish}
                            onChange={() => toggleAutoPublish(source.id, source.auto_publish)}
                            className="h-4 w-4 rounded cursor-pointer"
                            style={{ accentColor: 'var(--accent)' }}
                            aria-label={`Auto publishing for ${source.name}`}
                            title="Drafts from this source are approved automatically, without human review"
                          />
                          <span className="text-xs sm:hidden" style={{ color: 'var(--muted)' }}>Auto publishing</span>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )
        })}

        {/* Inactive sources */}
        {inactiveSources.length > 0 && (
          <div>
            <h3 className="text-xs font-medium uppercase tracking-wide mb-3" style={{ color: 'var(--muted)' }}>
              Disabled ({inactiveSources.length})
            </h3>
            <div className="flex flex-col gap-2">
              {inactiveSources.map(source => (
                <Card key={source.id} className="p-3 opacity-50">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="font-medium text-sm" style={{ color: 'var(--text)' }}>{source.name}</p>
                      <p className="text-xs truncate" style={{ color: 'var(--muted)' }}>{source.url}</p>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <Button size="sm" variant="secondary" onClick={() => toggle(source.id, source.active)}>Enable</Button>
                      <Button size="sm" variant="danger" onClick={() => remove(source.id)}>Delete</Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Add source — bottom, width-constrained so fields stay readable */}
      <div className="mt-10 max-w-xl">
        <h2 className="text-sm font-medium uppercase tracking-wide mb-4" style={{ color: 'var(--muted)' }}>Add source</h2>
        <SourceForm onAdded={load} />

        <div className="mt-6 rounded-lg p-4 text-sm" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', color: 'var(--muted)' }}>
          <p className="font-medium mb-1" style={{ color: 'var(--text)' }}>How batches work</p>
          <p>Active sources are grouped into batches of {BATCH_SIZE} by the order they were added. Each batch can be ingested independently — useful for testing a specific source or staying within execution time limits.</p>
          <p className="mt-2">New sources are automatically placed into the next available batch slot.</p>
          <p className="mt-2 font-mono text-xs" style={{ color: 'var(--muted)' }}>Daily ingest runs via GitHub Actions at 10:30 UTC.</p>
        </div>
      </div>
    </div>
  )
}
