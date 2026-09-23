import Parser from 'rss-parser'
import { FileState, MediaResolution, ThinkingLevel, createPartFromUri, type Part } from '@google/genai'
import type { createServiceClient } from '@/lib/supabase/server'
import { fetchFeed } from '@/lib/rss'
import { getGemini } from '@/lib/gemini'
import { DEFAULT_PODCAST_EXTRACTOR_PROMPT, DEFAULT_PODCAST_PROMPT, todayLine } from '@/lib/prompts'
import { DEFAULT_PODCAST_MODEL, type PodcastConfig } from '@/lib/podcastConfig'

/**
 * Podcast sources — rss_sources rows with kind = 'podcast'.
 *
 * These are MANUAL-ONLY by design: /api/ingest skips them, and the only caller
 * of this module's token-spending functions is /api/podcasts/[id]/ingest, which
 * accepts an admin session only and always creates a *pending* draft. An
 * episode is condensed into notes and written up by Google Gemini — nothing
 * happens unless someone clicks "Generate draft".
 *
 * Gemini listens to the episode itself, so there is no separate transcription
 * step. The source's `url` is either a YouTube channel feed
 * (https://www.youtube.com/feeds/videos.xml?channel_id=…) — Gemini is handed
 * the public video URL directly — or a podcast audio RSS feed, whose MP3 is
 * uploaded to the Gemini Files API. A pasted transcript overrides both.
 */

type Service = ReturnType<typeof createServiceClient>

export {
  PODCAST_CONFIG_TEMPLATE,
  parsePodcastConfig,
  type PodcastConfig,
  type PodcastPerson,
} from '@/lib/podcastConfig'

// ── Episodes ─────────────────────────────────────────────────────────────────

export interface PodcastEpisode {
  /** Stable id within the feed (guid / Atom id), used to pick an episode. */
  id: string
  title: string
  link: string
  pubDate: string | null
  description: string
  audioUrl: string | null
  audioType: string | null
  /** e.g. "52:14" as the feed states it. */
  duration: string | null
  /** The episode's own YouTube video, when it could be determined. */
  youtubeUrl: string | null
}

type FeedItem = {
  guid?: string
  id?: string
  title?: string
  link?: string
  pubDate?: string
  isoDate?: string
  contentSnippet?: string
  content?: string
  enclosure?: { url?: string; type?: string; length?: string }
  itunes?: { duration?: string; summary?: string }
  mediaGroup?: { 'media:description'?: string[] }
}

const parser = new Parser<Record<string, unknown>, FeedItem>({
  customFields: { item: [['media:group', 'mediaGroup']] },
})

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'

export function isYouTubeUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '')
    return host === 'youtube.com' || host === 'youtu.be' || host === 'm.youtube.com'
  } catch {
    return false
  }
}

/** Reads the feed and returns its episodes, newest first. Costs no tokens. */
export async function listEpisodes(feedUrl: string, config: PodcastConfig): Promise<PodcastEpisode[]> {
  const res = await fetch(feedUrl, {
    headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.7' },
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) throw new Error(`Feed HTTP ${res.status}`)
  const feed = await parser.parseString(await res.text())

  const episodes: PodcastEpisode[] = feed.items.map(item => {
    const link = item.link ?? ''
    const audio = item.enclosure?.url && (item.enclosure.type ?? '').startsWith('audio') ? item.enclosure : null
    const description =
      item.mediaGroup?.['media:description']?.[0] ??
      item.itunes?.summary ??
      item.contentSnippet ??
      ''
    return {
      id: item.guid || item.id || link || item.title || '',
      title: (item.title ?? '').trim(),
      link,
      pubDate: item.isoDate ?? item.pubDate ?? null,
      description: description.trim().slice(0, 4000),
      audioUrl: audio?.url ?? null,
      audioType: audio?.type ?? null,
      duration: item.itunes?.duration ?? null,
      youtubeUrl: isYouTubeUrl(link) ? link : null,
    }
  }).filter(e => e.id && e.title)

  // Audio feed: try to pair each episode with its video, so the article can
  // link the episode itself rather than just the channel.
  if (config.youtube_channel_id && episodes.some(e => !e.youtubeUrl)) {
    const videos = await fetchFeed(`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(config.youtube_channel_id)}`)
    for (const ep of episodes) {
      if (!ep.youtubeUrl) ep.youtubeUrl = matchVideo(ep, videos)
    }
  }

  return episodes.sort((a, b) => (b.pubDate ? Date.parse(b.pubDate) : 0) - (a.pubDate ? Date.parse(a.pubDate) : 0))
}

function titleTokens(s: string): Set<string> {
  return new Set(s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(w => w.length > 2))
}

function matchVideo(ep: PodcastEpisode, videos: { title: string; link: string; pubDate?: string }[]): string | null {
  const a = titleTokens(ep.title)
  let best: { link: string; score: number } | null = null
  for (const v of videos) {
    const b = titleTokens(v.title)
    const shared = [...a].filter(w => b.has(w)).length
    const score = shared / Math.max(1, Math.min(a.size, b.size))
    if (!best || score > best.score) best = { link: v.link, score }
  }
  return best && best.score >= 0.6 ? best.link : null
}

// ── Episode media → notes ────────────────────────────────────────────────────

/** What Gemini is given for an episode, in order of preference. */
export type EpisodeMedia =
  | { kind: 'transcript'; text: string }
  | { kind: 'youtube'; url: string }
  | { kind: 'audio'; url: string; mimeType: string | null }

// A panel podcast is talk: the audio carries almost everything. Sampling one
// frame every 5 s at low resolution still catches on-screen name captions
// while keeping an hour-long video to a fraction of the default token cost.
const VIDEO_FPS = 0.2
const MAX_AUDIO_BYTES = 300 * 1024 * 1024
const FILE_ACTIVE_TIMEOUT_MS = 120_000
// Transcripts past this are truncated — ~2 hours of speech.
const MAX_TRANSCRIPT_CHARS = 250_000
// Each step runs in its own 300 s Vercel function. Stop Gemini a little
// earlier so the admin sees a clear error instead of a bare platform 504.
const GEMINI_CALL_TIMEOUT_MS = 270_000

/** Draft body between step 1 (notes saved) and step 2 (article written). */
export const WRITING_PLACEHOLDER =
  '_The article has not been written yet. The episode notes are saved on this draft — use **Re-run** to write it._'

function timeoutError(err: unknown, what: string): Error {
  if (err instanceof Error && (err.name === 'AbortError' || /abort/i.test(err.message))) {
    return new Error(`Gemini did not finish ${what} within ${GEMINI_CALL_TIMEOUT_MS / 1000} s`)
  }
  return err instanceof Error ? err : new Error(String(err))
}

async function getPrompt(supabase: Service, key: string, fallback: string): Promise<string> {
  try {
    const { data } = await supabase.from('settings').select('value').eq('key', key).single()
    return data?.value || fallback
  } catch {
    return fallback
  }
}

function rosterBlock(config: PodcastConfig): string {
  return config.people
    .map(p => `- ${p.name}${p.role ? ` — ${p.role}` : ''}${p.linkedin ? ` — LinkedIn: ${p.linkedin}` : ' — (no link)'}`)
    .join('\n')
}

/** Uploads an episode's audio to the Gemini Files API and waits until it is usable. */
async function uploadAudio(url: string, mimeType: string | null): Promise<{ part: Part; cleanup: () => Promise<void> }> {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(90000) })
  if (!res.ok) throw new Error(`Audio HTTP ${res.status}`)
  const declared = Number(res.headers.get('content-length') ?? 0)
  if (declared > MAX_AUDIO_BYTES) throw new Error(`Audio is ${Math.round(declared / 1e6)} MB — too large`)
  const type = mimeType || res.headers.get('content-type') || 'audio/mpeg'
  const blob = new Blob([await res.arrayBuffer()], { type })

  const ai = getGemini()
  let file = await ai.files.upload({ file: blob, config: { mimeType: type } })
  const deadline = Date.now() + FILE_ACTIVE_TIMEOUT_MS
  while (file.state === FileState.PROCESSING && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 3000))
    file = await ai.files.get({ name: file.name! })
  }
  if (file.state !== FileState.ACTIVE || !file.uri) throw new Error(`Gemini could not process the audio (state ${file.state})`)
  return {
    part: createPartFromUri(file.uri, file.mimeType ?? type),
    // Uploaded files expire on their own after 48 h; deleting is just tidiness.
    cleanup: async () => { await ai.files.delete({ name: file.name! }).catch(() => {}) },
  }
}

/**
 * Stage 1: the episode (video, audio or pasted transcript) → structured notes.
 * This is the only call that sees the full episode, and its output is stored
 * on the draft, so a re-run never pays for the media again. Returns null for
 * UNUSABLE_CONTENT.
 */
export async function extractPodcastNotes(
  supabase: Service,
  config: PodcastConfig,
  episode: Pick<PodcastEpisode, 'title' | 'pubDate' | 'description'>,
  media: EpisodeMedia,
): Promise<string | null> {
  const prompt = await getPrompt(supabase, 'prompt_podcast_extractor', DEFAULT_PODCAST_EXTRACTOR_PROMPT)
  const context = [
    todayLine(),
    `Podcast: ${config.show_name}`,
    `Episode title: ${episode.title}`,
    episode.pubDate ? `Published: ${episode.pubDate.slice(0, 10)}` : '',
    episode.description ? `Episode description:\n${episode.description}` : '',
    `Regular panel / known people (use for name spelling):\n${rosterBlock(config)}`,
  ].filter(Boolean).join('\n\n')

  let mediaPart: Part
  let cleanup = async () => {}
  if (media.kind === 'transcript') {
    mediaPart = { text: `Transcript:\n${media.text.slice(0, MAX_TRANSCRIPT_CHARS)}` }
  } else if (media.kind === 'youtube') {
    mediaPart = { fileData: { fileUri: media.url, mimeType: 'video/*' }, videoMetadata: { fps: VIDEO_FPS } }
  } else {
    const uploaded = await uploadAudio(media.url, media.mimeType)
    mediaPart = uploaded.part
    cleanup = uploaded.cleanup
  }

  try {
    const res = await getGemini().models.generateContent({
      model: config.model ?? DEFAULT_PODCAST_MODEL,
      contents: [{
        role: 'user',
        parts: [
          mediaPart,
          { text: `${context}\n\nThe ${media.kind === 'transcript' ? 'transcript above' : 'recording above'} is the full episode. Produce the notes.` },
        ],
      }],
      config: {
        systemInstruction: prompt,
        // Condensing an episode into notes is summarising, not reasoning;
        // low thinking keeps an hour of media inside the function budget.
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        abortSignal: AbortSignal.timeout(GEMINI_CALL_TIMEOUT_MS),
        ...(media.kind === 'youtube' ? { mediaResolution: MediaResolution.MEDIA_RESOLUTION_LOW } : {}),
      },
    })
    const notes = (res.text ?? '').trim()
    return !notes || notes === 'UNUSABLE_CONTENT' ? null : notes
  } catch (err) {
    throw timeoutError(err, `watching the ${media.kind === 'transcript' ? 'transcript' : media.kind === 'youtube' ? 'video' : 'audio'}`)
  } finally {
    await cleanup()
  }
}

// ── Writing ──────────────────────────────────────────────────────────────────

/**
 * Stage 2: notes → article markdown (with H1). Also used by the draft re-run
 * route, so a re-run keeps the podcast format and links instead of falling
 * back to the news-article prompt.
 */
export async function writePodcastArticle(
  supabase: Service,
  config: PodcastConfig,
  args: { episodeTitle: string; episodeYouTubeUrl: string | null; notes: string; instruction?: string },
): Promise<{ title: string; content: string }> {
  const prompt = await getPrompt(supabase, 'prompt_podcast', DEFAULT_PODCAST_PROMPT)
  const input = [
    `Podcast: ${config.show_name}`,
    `Episode title: ${args.episodeTitle}`,
    `Participants (link names to these LinkedIn URLs only):\n${rosterBlock(config)}`,
    'Podcast links:',
    config.spotify_url ? `- Spotify: ${config.spotify_url}` : '- Spotify: (none — do not link Spotify)',
    args.episodeYouTubeUrl ? `- YouTube (this episode): ${args.episodeYouTubeUrl}` : '',
    config.youtube_channel_url ? `- YouTube (channel): ${config.youtube_channel_url}` : '',
    config.apple_url ? `- Apple Podcasts: ${config.apple_url}` : '',
    `Episode notes:\n${args.notes}`,
  ].filter(Boolean).join('\n')

  const systemInstruction = args.instruction
    ? `${prompt}\n\nADDITIONAL EDITORIAL INSTRUCTION FOR THIS RE-RUN (shape, angle, emphasis and length only — the notes and links stay fixed):\n\n${args.instruction}`
    : prompt

  let res
  try {
    res = await getGemini().models.generateContent({
      model: config.model ?? DEFAULT_PODCAST_MODEL,
      contents: input,
      config: { systemInstruction, abortSignal: AbortSignal.timeout(GEMINI_CALL_TIMEOUT_MS) },
    })
  } catch (err) {
    throw timeoutError(err, 'the write-up')
  }
  const raw = (res.text ?? '').trim()
    // Some models wrap the whole article in a ```markdown fence.
    .replace(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/, '$1')
    .trim()
  const titleMatch = raw.match(/^#\s+(.+)$/m)
  const title = titleMatch ? titleMatch[1].trim() : args.episodeTitle
  const body = raw.replace(/^[\s\S]*?^#\s+.+\n?/m, '').trimStart()
  const content = ensurePlatformLinks(sanitizePodcastLinks(body, config, args.episodeYouTubeUrl), config, args.episodeYouTubeUrl)
  return { title, content }
}

function normalizeUrl(u: string): string {
  return u.trim().replace(/\/+$/, '').toLowerCase()
}

/**
 * Keeps only absolute links the config (or the episode) actually lists; any
 * other absolute URL the model produced is unlinked to plain text. Past
 * hand-written Signal Room articles carried guessed LinkedIn slugs and three
 * different Spotify ids — this makes that impossible here.
 */
export function sanitizePodcastLinks(markdown: string, config: PodcastConfig, episodeYouTubeUrl: string | null): string {
  const allowed = new Set(
    [
      config.spotify_url,
      config.youtube_channel_url,
      config.apple_url,
      episodeYouTubeUrl,
      ...config.people.map(p => p.linkedin),
    ].filter((u): u is string => !!u).map(normalizeUrl),
  )
  return markdown.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (whole, text: string, url: string) =>
    allowed.has(normalizeUrl(url)) ? whole : text,
  )
}

/** Appends a listen line if the model left out the Spotify or YouTube link. */
export function ensurePlatformLinks(markdown: string, config: PodcastConfig, episodeYouTubeUrl: string | null): string {
  const youtube = episodeYouTubeUrl ?? config.youtube_channel_url
  const has = (u?: string | null) => !!u && markdown.toLowerCase().includes(normalizeUrl(u))
  const missing: string[] = []
  if (config.spotify_url && !has(config.spotify_url)) missing.push(`listen on [Spotify](${config.spotify_url})`)
  if (youtube && !has(youtube)) missing.push(`watch on [YouTube](${youtube})`)
  if (missing.length === 0) return markdown
  return `${markdown.trimEnd()}\n\nTo hear the full conversation, ${missing.join(' or ')}.\n`
}
