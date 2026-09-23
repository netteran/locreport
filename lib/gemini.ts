import { GoogleGenAI } from '@google/genai'

// Google Gemini client, used only by podcast sources (lib/podcast.ts). Everything
// else in the pipeline stays on OpenAI (lib/openai.ts).
// Default model id lives with the podcast config: DEFAULT_PODCAST_MODEL in lib/podcastConfig.ts.

let _client: GoogleGenAI | null = null

export function getGemini(): GoogleGenAI {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not set — add it in Vercel to use podcast sources')
  }
  if (!_client) {
    _client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  }
  return _client
}
