'use client'
import { useState } from 'react'
import Link from 'next/link'
import type { RssSource } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

type Episode = {
  id: string
  title: string
  link: string
  pubDate: string | null
  audioUrl: string | null
  duration: string | null
  youtubeUrl: string | null
  draft: { id: string; status: string } | null
  article: { slug: string } | null
}

type Props = {
  source: RssSource
  onChanged: () => void
  onToggleActive: () => void
  onDelete: () => void
}

// One podcast source on /admin/sources. Nothing here runs on its own: listing
// episodes only reads the feed, and a draft is generated only after the
// explicit confirm step below — the only path that spends OpenAI tokens.
export function PodcastSourceCard({ source, onChanged, onToggleActive, onDelete }: Props) {
  const [episodes, setEpisodes] = useState<Episode[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [editingConfig, setEditingConfig] = useState(false)
  const [configText, setConfigText] = useState('')
  const [editUrl, setEditUrl] = useState('')

  async function loadEpisodes() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/podcasts/${source.id}/episodes`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      setEpisodes(data.episodes)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load episodes')
    } finally {
      setLoading(false)
    }
  }

  function startEdit() {
    setConfigText(JSON.stringify(source.podcast_config ?? {}, null, 2))
    setEditUrl(source.url)
    setEditingConfig(true)
    setError('')
  }

  async function saveConfig() {
    let parsed: unknown
    try {
      parsed = JSON.parse(configText)
    } catch {
      setError('Config is not valid JSON')
      return
    }
    const res = await fetch(`/api/sources/${source.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: editUrl, podcast_config: parsed }),
    })
    if (!res.ok) {
      setError((await res.json()).error ?? 'Save failed')
      return
    }
    setEditingConfig(false)
    onChanged()
  }

  const cfg = source.podcast_config

  return (
    <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)' }}>
      <div className="px-4 py-3 flex flex-col gap-3 sm:flex-row sm:items-center" style={{ background: 'var(--surface, var(--bg))' }}>
        <div className="min-w-0 sm:flex-1">
          <p className="font-medium text-sm" style={{ color: 'var(--text)' }}>
            {source.name}
            <span className="ml-2 text-xs font-mono px-1.5 py-0.5 rounded" style={{ border: '1px solid var(--border)', color: 'var(--muted)' }}>
              manual only · drafts
            </span>
          </p>
          <p className="text-xs truncate" style={{ color: 'var(--muted)' }}>{source.url}</p>
          {cfg && (
            <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
              {cfg.people.length} people · writer {cfg.writer_model ?? 'gpt-4o-mini'}
              {!cfg.spotify_url && ' · no Spotify link set'}
            </p>
          )}
        </div>
        <div className="flex gap-2 flex-wrap shrink-0 items-center">
          <Button size="sm" onClick={loadEpisodes} disabled={loading}>{loading ? 'Loading…' : episodes ? 'Refresh episodes' : 'Episodes'}</Button>
          <Button size="sm" variant="secondary" onClick={startEdit}>Edit</Button>
          <Button size="sm" variant="secondary" onClick={onToggleActive}>Disable</Button>
          <Button size="sm" variant="danger" onClick={onDelete}>Delete</Button>
        </div>
      </div>

      {error && <p className="px-4 pb-3 text-sm text-red-600">{error}</p>}

      {editingConfig && (
        <div className="px-4 py-3 flex flex-col gap-2" style={{ borderTop: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
          <Input value={editUrl} onChange={e => setEditUrl(e.target.value)} placeholder="Podcast audio RSS or YouTube channel feed URL" />
          <Textarea value={configText} onChange={e => setConfigText(e.target.value)} rows={16} className="font-mono text-xs" />
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            The writer may only use links listed here — any other link it produces is stripped. writer_model: gpt-4o-mini or gpt-4o.
          </p>
          <div className="flex gap-2">
            <Button size="sm" onClick={saveConfig}>Save</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditingConfig(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {episodes && (
        <div className="flex flex-col divide-y" style={{ borderTop: '1px solid var(--border)', borderColor: 'var(--hairline, var(--border))' }}>
          {episodes.length === 0 && <p className="px-4 py-3 text-sm" style={{ color: 'var(--muted)' }}>No episodes in the feed.</p>}
          {episodes.map(ep => (
            <EpisodeRow key={ep.id} sourceId={source.id} episode={ep} onGenerated={loadEpisodes} />
          ))}
        </div>
      )}
    </div>
  )
}

function EpisodeRow({ sourceId, episode, onGenerated }: { sourceId: string; episode: Episode; onGenerated: () => void }) {
  const [open, setOpen] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [youtubeUrl, setYoutubeUrl] = useState(episode.youtubeUrl ?? '')
  const [running, setRunning] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string; draftId?: string } | null>(null)

  const done = episode.article || episode.draft
  const needsPaste = !episode.audioUrl

  async function generate() {
    setRunning(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/podcasts/${sourceId}/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          episode_id: episode.id,
          transcript: transcript.trim() || undefined,
          youtube_url: youtubeUrl.trim() || undefined,
          force: !!done,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      setMessage({ ok: true, text: `Draft created — ${data.words} words (${data.transcript_source} transcript).`, draftId: data.draft_id })
      setOpen(false)
      onGenerated()
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : 'Generation failed' })
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="px-4 py-3" style={{ background: 'var(--surface, var(--bg))' }}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="min-w-0 sm:flex-1">
          <p className="text-sm" style={{ color: 'var(--text)' }}>{episode.title}</p>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            {episode.pubDate ? new Date(episode.pubDate).toISOString().slice(0, 10) : 'no date'}
            {episode.duration && ` · ${episode.duration}`}
            {episode.audioUrl ? ' · audio' : ' · no audio (paste transcript)'}
            {episode.youtubeUrl && <> · <a href={episode.youtubeUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>video</a></>}
            {episode.article && <> · <Link href={`/articles/${episode.article.slug}`} style={{ color: 'var(--accent)' }}>published</Link></>}
            {!episode.article && episode.draft && <> · <Link href={`/admin/drafts/${episode.draft.id}`} style={{ color: 'var(--accent)' }}>draft ({episode.draft.status})</Link></>}
          </p>
        </div>
        {!open && (
          <Button size="sm" variant={done ? 'ghost' : 'secondary'} onClick={() => setOpen(true)}>
            {done ? 'Generate again…' : 'Generate draft…'}
          </Button>
        )}
      </div>

      {open && (
        <div className="mt-3 flex flex-col gap-2">
          <Input value={youtubeUrl} onChange={e => setYoutubeUrl(e.target.value)} placeholder="YouTube URL of this episode (optional, used for the article link)" />
          <Textarea
            value={transcript}
            onChange={e => setTranscript(e.target.value)}
            rows={5}
            placeholder={needsPaste
              ? 'Paste the transcript (required — this feed has no audio). YouTube: … → Show transcript → copy.'
              : 'Optional: paste a transcript to skip audio transcription.'}
          />
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            Spends OpenAI tokens: {transcript.trim() ? 'notes + write-up (a few cents)' : 'audio transcription (~$0.20/hour) + notes + write-up'}.
            Creates a pending draft only — nothing is published.
            {done && ' This episode already has a draft/article; a second draft will be created.'}
          </p>
          <div className="flex gap-2">
            <Button size="sm" onClick={generate} disabled={running || (needsPaste && !transcript.trim())}>
              {running ? <span className="animate-pulse">Generating… (can take a few minutes)</span> : 'Confirm — generate draft'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={running}>Cancel</Button>
          </div>
        </div>
      )}

      {message && (
        <p className={`mt-2 text-sm ${message.ok ? '' : 'text-red-600'}`} style={message.ok ? { color: 'var(--accent)' } : undefined}>
          {message.text}
          {message.draftId && <> <Link href={`/admin/drafts/${message.draftId}`} className="underline">Open draft →</Link></>}
        </p>
      )}
    </div>
  )
}
