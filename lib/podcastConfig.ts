// Podcast source config — pure data + validation, safe to import from client
// components (the admin forms). The token-spending code lives in lib/podcast.ts.

export interface PodcastPerson {
  name: string
  role?: string
  linkedin?: string
}

export interface PodcastConfig {
  show_name: string
  spotify_url?: string
  youtube_channel_url?: string
  /** UC… id — lets an audio-feed episode be matched to its YouTube video (Gemini reads the video directly). */
  youtube_channel_id?: string
  apple_url?: string
  people: PodcastPerson[]
  /**
   * Gemini model id for both steps (episode notes + write-up), e.g.
   * "gemini-3.5-flash" (default) or a Pro model for a stronger write-up.
   */
  model?: string
}

export const DEFAULT_PODCAST_MODEL = 'gemini-3.5-flash'
const MODEL_ID = /^gemini-[a-z0-9.-]+$/

// Prefilled when adding a podcast source. Links are taken from the most
// consistent of the hand-written Signal Room articles — verify before use;
// Spotify is left blank because past articles disagree on the show id.
export const PODCAST_CONFIG_TEMPLATE: PodcastConfig = {
  show_name: 'The Signal Room Podcast',
  spotify_url: '',
  youtube_channel_url: 'https://www.youtube.com/@TheSignalRoomPodcast',
  youtube_channel_id: '',
  apple_url: 'https://podcasts.apple.com/us/podcast/the-signal-room-podcast/id1884996208',
  people: [
    { name: 'Jonas Ryberg', role: 'SVP of Multilingual AI at Centific', linkedin: 'https://www.linkedin.com/in/jonasryberg1/' },
    { name: 'Vincent Swan', role: 'VP of Innovation and Solutions at Centific', linkedin: 'https://www.linkedin.com/in/vincent-swan-93053211/' },
    { name: 'Karina Welch', role: 'Director of Corporate Strategy and Head of the CEO Office at Centific', linkedin: 'https://www.linkedin.com/in/karinawelch/' },
    { name: "Wada'a Fahel", role: 'Localization and content technology strategist, founder of LocVerse Consulting', linkedin: 'https://www.linkedin.com/in/wadaafahel/' },
  ],
  model: DEFAULT_PODCAST_MODEL,
}

export function parsePodcastConfig(raw: unknown): { config: PodcastConfig } | { error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'podcast_config must be a JSON object' }
  const r = raw as Record<string, unknown>
  if (typeof r.show_name !== 'string' || !r.show_name.trim()) return { error: 'podcast_config.show_name is required' }
  if (!Array.isArray(r.people)) return { error: 'podcast_config.people must be an array' }
  const people: PodcastPerson[] = []
  for (const p of r.people) {
    if (!p || typeof p !== 'object' || typeof (p as PodcastPerson).name !== 'string' || !(p as PodcastPerson).name.trim()) {
      return { error: 'every entry in podcast_config.people needs a name' }
    }
    const { name, role, linkedin } = p as PodcastPerson
    people.push({
      name: name.trim(),
      role: typeof role === 'string' && role.trim() ? role.trim() : undefined,
      linkedin: typeof linkedin === 'string' && linkedin.trim() ? linkedin.trim() : undefined,
    })
  }
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
  const model = str(r.model)
  if (model !== undefined && !MODEL_ID.test(model)) {
    return { error: 'podcast_config.model must be a Gemini model id, e.g. "gemini-3.5-flash"' }
  }
  return {
    config: {
      show_name: r.show_name.trim(),
      spotify_url: str(r.spotify_url),
      youtube_channel_url: str(r.youtube_channel_url),
      youtube_channel_id: str(r.youtube_channel_id),
      apple_url: str(r.apple_url),
      people,
      model: model ?? DEFAULT_PODCAST_MODEL,
    },
  }
}
