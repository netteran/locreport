'use client'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
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

// The Episodes panel under a podcast row on /admin/sources. Listing only reads
// the feed; a draft is generated only after the explicit confirm step below.
export function PodcastEpisodes({ sourceId }: { sourceId: string }) {
  const [episodes, setEpisodes] = useState<Episode[] | null>(null)
  const [hidden, setHidden] = useState<{ count: number; before: string | null }>({ count: 0, before: null })
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setError('')
    try {
      const res = await fetch(`/api/podcasts/${sourceId}/episodes`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      setEpisodes(data.episodes)
      setHidden({ count: data.hidden_before_baseline ?? 0, before: data.ignore_before ?? null })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load episodes')
    }
  }, [sourceId])

  useEffect(() => { load() }, [load])

  if (error) return <p className="text-xs text-red-600">{error}</p>
  if (!episodes) return <p className="text-xs animate-pulse" style={{ color: 'var(--muted)' }}>Reading feed…</p>

  return (
    <div className="flex flex-col divide-y" style={{ borderColor: 'var(--hairline, var(--border))' }}>
      {episodes.length === 0 && (
        <p className="py-1 text-xs" style={{ color: 'var(--muted)' }}>
          {hidden.before ? 'No new full episodes since the baseline.' : 'No episodes in the feed.'}
        </p>
      )}
      {episodes.map(ep => (
        <EpisodeRow key={ep.id} sourceId={sourceId} episode={ep} onGenerated={load} />
      ))}
      {hidden.count > 0 && (
        <p className="py-1 text-xs" style={{ color: 'var(--muted)' }}>
          {hidden.count} older episode{hidden.count !== 1 ? 's' : ''} (on or before {hidden.before?.slice(0, 10)}) hidden as seen. Shorts are always excluded.
        </p>
      )}
    </div>
  )
}

function EpisodeRow({ sourceId, episode, onGenerated }: { sourceId: string; episode: Episode; onGenerated: () => void }) {
  const [open, setOpen] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [youtubeUrl, setYoutubeUrl] = useState(episode.youtubeUrl ?? '')
  const [running, setRunning] = useState<null | 'notes' | 'write'>(null)
  const [message, setMessage] = useState<{ ok: boolean; text: string; draftId?: string } | null>(null)

  const done = episode.article || episode.draft
  // Gemini watches the YouTube video or listens to the audio; only an episode
  // with neither needs a transcript pasted in (or a YouTube URL typed above).
  const needsPaste = !episode.audioUrl && !youtubeUrl.trim()

  // Two requests, each with its own 300 s function budget: step 1 has Gemini
  // watch the episode and saves the notes on a new draft; step 2 writes the
  // article into it. If step 2 fails, the draft's Re-run finishes it later.
  async function generate() {
    setMessage(null)
    let draftId: string | undefined
    try {
      setRunning('notes')
      const step1 = await postJson(`/api/podcasts/${sourceId}/ingest`, {
        episode_id: episode.id,
        transcript: transcript.trim() || undefined,
        youtube_url: youtubeUrl.trim() || undefined,
        force: !!done,
      })
      draftId = step1.draft_id as string
      setRunning('write')
      const step2 = await postJson(`/api/podcasts/${sourceId}/write`, { draft_id: draftId })
      setMessage({ ok: true, text: `Draft created — ${step2.words} words, from the ${step1.media} with ${step2.model}.`, draftId })
      setOpen(false)
      onGenerated()
    } catch (err) {
      const text = err instanceof Error ? err.message : 'Generation failed'
      setMessage(draftId
        ? { ok: false, text: `Episode notes were saved, but the write-up failed: ${text} Open the draft and use Re-run to finish it.`, draftId }
        : { ok: false, text })
      if (draftId) onGenerated()
    } finally {
      setRunning(null)
    }
  }

  return (
    <div className="py-1">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center">
        <div className="min-w-0 sm:flex-1">
          <p className="text-xs" style={{ color: 'var(--text)' }}>
            <span className="font-medium">{episode.title}</span>
            <span style={{ color: 'var(--muted)' }}> · 
            {episode.pubDate ? new Date(episode.pubDate).toISOString().slice(0, 10) : 'no date'}
            {episode.duration && ` · ${episode.duration}`}
            {episode.youtubeUrl ? ' · video' : episode.audioUrl ? ' · audio' : ' · no video/audio (paste transcript)'}
            {episode.youtubeUrl && <> · <a href={episode.youtubeUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>watch</a></>}
            {episode.article && <> · <Link href={`/articles/${episode.article.slug}`} style={{ color: 'var(--accent)' }}>published</Link></>}
            {!episode.article && episode.draft && <> · <Link href={`/admin/drafts/${episode.draft.id}`} style={{ color: 'var(--accent)' }}>draft ({episode.draft.status})</Link></>}
            </span>
          </p>
        </div>
        {!open && (
          <Button size="xs" variant={done ? 'ghost' : 'secondary'} onClick={() => setOpen(true)}>
            {done ? 'Generate again…' : 'Generate draft…'}
          </Button>
        )}
      </div>

      {open && (
        <div className="mt-1 flex flex-col gap-1">
          <Input value={youtubeUrl} onChange={e => setYoutubeUrl(e.target.value)} placeholder="YouTube URL of this episode (optional, used for the article link)" />
          <Textarea
            value={transcript}
            onChange={e => setTranscript(e.target.value)}
            rows={3}
            placeholder={needsPaste
              ? 'Paste the transcript, or add the YouTube URL above (one of the two is required).'
              : 'Optional: paste a transcript instead — Gemini will read it rather than watching/listening.'}
          />
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            Spends Gemini tokens: {transcript.trim() ? 'notes from the pasted transcript' : youtubeUrl.trim() ? 'Gemini watches the YouTube video' : 'Gemini listens to the audio'} + write-up.
            Creates a pending draft only — nothing is published from here.
            {done && ' This episode already has a draft/article; a second draft will be created.'}
          </p>
          <div className="flex gap-1">
            <Button size="xs" onClick={generate} disabled={!!running || (needsPaste && !transcript.trim())}>
              {running === 'notes' && <span className="animate-pulse">Step 1/2: Gemini is going through the episode… (up to ~5 min)</span>}
              {running === 'write' && <span className="animate-pulse">Step 2/2: writing the article…</span>}
              {!running && 'Confirm — generate draft'}
            </Button>
            <Button size="xs" variant="ghost" onClick={() => setOpen(false)} disabled={!!running}>Cancel</Button>
          </div>
        </div>
      )}

      {message && (
        <p className={`mt-1 text-xs ${message.ok ? '' : 'text-red-600'}`} style={message.ok ? { color: 'var(--accent)' } : undefined}>
          {message.text}
          {message.draftId && <> <Link href={`/admin/drafts/${message.draftId}`} className="underline">Open draft →</Link></>}
        </p>
      )}
    </div>
  )
}

// A platform timeout answers with an HTML error page, not JSON — surface that
// as a readable message instead of a JSON parse error.
export async function postJson(url: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  let data: Record<string, unknown> | null = null
  try {
    data = await res.json()
  } catch {
    // not JSON
  }
  if (!res.ok || !data) {
    if (res.status === 504) throw new Error('Timed out after 5 minutes (Vercel function limit).')
    throw new Error((data?.error as string) ?? `HTTP ${res.status}`)
  }
  return data
}
