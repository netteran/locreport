import Parser from 'rss-parser'
import { toFile } from 'openai'
import type OpenAI from 'openai'
import type { createServiceClient } from '@/lib/supabase/server'
import { fetchFeed } from '@/lib/rss'
import { DEFAULT_PODCAST_EXTRACTOR_PROMPT, DEFAULT_PODCAST_PROMPT, todayLine } from '@/lib/prompts'
import { DEFAULT_WRITER_MODEL, type PodcastConfig } from '@/lib/podcastConfig'

/**
 * Podcast sources — rss_sources rows with kind = 'podcast'.
 *
 * These are MANUAL-ONLY by design: /api/ingest skips them, and the only caller
 * of this module's token-spending functions is /api/podcasts/[id]/ingest, which
 * accepts an admin session only and always creates a *pending* draft. An
 * episode is transcribed (or takes a pasted transcript), condensed into notes,
 * and written up — nothing happens unless someone clicks "Generate draft".
 *
 * The source's `url` is either the podcast's audio RSS feed (episodes carry an
 * MP3 enclosure we can transcribe) or a YouTube channel feed
 * (https://www.youtube.com/feeds/videos.xml?channel_id=…), where there is no
 * audio to fetch and the transcript has to be pasted in.
 */

type Service = ReturnType<typeof createServiceClient>

export {
  PODCAST_CONFIG_TEMPLATE,
  WRITER_MODELS,
  parsePodcastConfig,
  type PodcastConfig,
  type PodcastPerson,
  type WriterModel,
} from '@/lib/podcastConfig'

const EXTRACTOR_MODEL = 'gpt-4o-mini'
const TRANSCRIBE_MODEL = 'gpt-4o-mini-transcribe'

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

// ── Transcription ────────────────────────────────────────────────────────────

const MAX_AUDIO_BYTES = 300 * 1024 * 1024
// gpt-4o-mini-transcribe caps output tokens per request, so a long episode is
// sent in short slices; ~6 minutes of speech stays well under that cap.
const SLICE_SECONDS = 6 * 60
const SLICE_CONCURRENCY = 4
const WHISPER_MAX_BYTES = 24 * 1024 * 1024

const MP3_BITRATES_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
const MP3_BITRATES_V2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]

function isFrameHeader(buf: Uint8Array, i: number): boolean {
  if (i + 3 >= buf.length) return false
  const b1 = buf[i + 1], b2 = buf[i + 2]
  return buf[i] === 0xff && (b1 & 0xe0) === 0xe0 && ((b1 >> 1) & 3) !== 0 && ((b2 >> 4) & 0xf) !== 0xf && ((b2 >> 4) & 0xf) !== 0 && ((b2 >> 2) & 3) !== 3
}

function nextFrame(buf: Uint8Array, from: number): number {
  for (let i = from; i < buf.length - 3; i++) if (isFrameHeader(buf, i)) return i
  return buf.length
}

/** Offset of the first audio byte, past any ID3v2 tag (whose cover art can fake a frame sync). */
function audioStart(buf: Uint8Array): number {
  if (buf.length > 10 && buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) {
    const size = (buf[6] << 21) | (buf[7] << 14) | (buf[8] << 7) | buf[9]
    return Math.min(buf.length, 10 + size)
  }
  return 0
}

/** kbps of the first MP3 frame, or 128 if it can't be read. */
function mp3Bitrate(buf: Uint8Array): number {
  const i = nextFrame(buf, audioStart(buf))
  if (i >= buf.length) return 128
  const mpeg1 = ((buf[i + 1] >> 3) & 3) === 3
  const idx = (buf[i + 2] >> 4) & 0xf
  return (mpeg1 ? MP3_BITRATES_V1_L3 : MP3_BITRATES_V2_L3)[idx] || 128
}

/** Splits an MP3 on frame boundaries into ~SLICE_SECONDS pieces. */
function sliceMp3(buf: Uint8Array): Uint8Array[] {
  const bytesPerSlice = Math.floor((mp3Bitrate(buf) * 1000 / 8) * SLICE_SECONDS)
  const slices: Uint8Array[] = []
  let start = nextFrame(buf, audioStart(buf))
  while (start < buf.length) {
    const end = start + bytesPerSlice >= buf.length ? buf.length : nextFrame(buf, start + bytesPerSlice)
    slices.push(buf.subarray(start, end))
    start = end
  }
  return slices
}

function looksLikeMp3(url: string, type: string | null): boolean {
  return (type ?? '').includes('mpeg') || (type ?? '').includes('mp3') || /\.mp3(\?|$)/i.test(url)
}

/**
 * Downloads an episode's audio and transcribes it. ~$0.003 per audio minute.
 * MP3 is sliced on frame boundaries and sent in parallel; other formats go to
 * whisper-1 whole, which only works up to 24 MB.
 */
export async function transcribeAudio(
  openai: OpenAI,
  audioUrl: string,
  audioType: string | null,
  config: PodcastConfig,
): Promise<string> {
  const res = await fetch(audioUrl, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(90000) })
  if (!res.ok) throw new Error(`Audio HTTP ${res.status}`)
  const declared = Number(res.headers.get('content-length') ?? 0)
  if (declared > MAX_AUDIO_BYTES) throw new Error(`Audio is ${Math.round(declared / 1e6)} MB — too large`)
  const buf = new Uint8Array(await res.arrayBuffer())
  const type = audioType ?? res.headers.get('content-type')

  // Spelling hint: the transcriber otherwise mangles names like "Wada'a Fahel".
  const hint = `${config.show_name}. ${config.people.map(p => [p.name, p.role].filter(Boolean).join(', ')).join('; ')}.`

  if (!looksLikeMp3(audioUrl, type)) {
    if (buf.length > WHISPER_MAX_BYTES) {
      throw new Error(`Audio is ${type ?? 'not MP3'} and ${Math.round(buf.length / 1e6)} MB — only MP3 can be split. Paste the transcript instead.`)
    }
    const r = await openai.audio.transcriptions.create({
      file: await toFile(buf, 'episode', { type: type ?? 'audio/mp4' }),
      model: 'whisper-1',
      prompt: hint,
    })
    return r.text
  }

  const slices = sliceMp3(buf)
  const texts: string[] = new Array(slices.length)
  let next = 0
  async function worker() {
    while (next < slices.length) {
      const i = next++
      const r = await openai.audio.transcriptions.create({
        file: await toFile(slices[i], `part-${i + 1}.mp3`, { type: 'audio/mpeg' }),
        model: TRANSCRIBE_MODEL,
        prompt: hint,
      })
      texts[i] = r.text
    }
  }
  await Promise.all(Array.from({ length: Math.min(SLICE_CONCURRENCY, slices.length) }, worker))
  return texts.join('\n\n')
}

// ── Writing ──────────────────────────────────────────────────────────────────

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

// Transcripts past this are truncated; ~2 hours of speech, far inside the
// extractor model's context window.
const MAX_TRANSCRIPT_CHARS = 250_000

/** Stage 1: full transcript → structured episode notes. Returns null for UNUSABLE_CONTENT. */
export async function extractPodcastNotes(
  openai: OpenAI,
  supabase: Service,
  config: PodcastConfig,
  episode: Pick<PodcastEpisode, 'title' | 'pubDate' | 'description'>,
  transcript: string,
): Promise<string | null> {
  const prompt = await getPrompt(supabase, 'prompt_podcast_extractor', DEFAULT_PODCAST_EXTRACTOR_PROMPT)
  const input = [
    todayLine(),
    `Podcast: ${config.show_name}`,
    `Episode title: ${episode.title}`,
    episode.pubDate ? `Published: ${episode.pubDate.slice(0, 10)}` : '',
    episode.description ? `Episode description:\n${episode.description}` : '',
    `Regular panel / known people (use for name spelling):\n${rosterBlock(config)}`,
    `Transcript:\n${transcript.slice(0, MAX_TRANSCRIPT_CHARS)}`,
  ].filter(Boolean).join('\n\n')

  const res = await openai.chat.completions.create({
    model: EXTRACTOR_MODEL,
    messages: [
      { role: 'system', content: prompt },
      { role: 'user', content: input },
    ],
  })
  const notes = (res.choices[0].message.content ?? '').trim()
  return !notes || notes === 'UNUSABLE_CONTENT' ? null : notes
}

/**
 * Stage 2: notes → article markdown (with H1). Also used by the draft re-run
 * route, so a re-run keeps the podcast format and links instead of falling
 * back to the news-article prompt.
 */
export async function writePodcastArticle(
  openai: OpenAI,
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

  const res = await openai.chat.completions.create({
    model: config.writer_model ?? DEFAULT_WRITER_MODEL,
    messages: [
      { role: 'system', content: prompt },
      ...(args.instruction ? [{ role: 'system' as const, content: `ADDITIONAL EDITORIAL INSTRUCTION FOR THIS RE-RUN (shape, angle, emphasis and length only — the notes and links stay fixed):\n\n${args.instruction}` }] : []),
      { role: 'user', content: input },
    ],
  })
  const raw = (res.choices[0].message.content ?? '').trim()
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
