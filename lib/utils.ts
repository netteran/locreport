const DOMAIN_PUBLISHER_MAP: Record<string, string> = {
  'locreport.com': 'LocReport',
  'slator.com': 'Slator',
  'argosmultilingual.com': 'Argos Multilingual',
  'argos-multilingual.com': 'Argos Multilingual',
  'nimdzi.com': 'Nimdzi Insights',
  'csa-research.com': 'CSA Research',
  'common-sense-advisory.com': 'Common Sense Advisory',
  'multilingual.com': 'Multilingual',
  'gala-global.org': 'GALA',
  'taus.net': 'TAUS',
  'atanet.org': 'ATA',
  'proz.com': 'ProZ',
  'translatorscafe.com': 'TranslatorsCafe',
  'tcworld.info': 'tcworld',
  'sdl.com': 'SDL',
  'rws.com': 'RWS',
  'translated.com': 'Translated',
  'lionbridge.com': 'Lionbridge',
  'transperfect.com': 'TransPerfect',
  'welocalize.com': 'Welocalize',
  'languageline.com': 'LanguageLine',
  'moravia.com': 'Moravia',
  'xillio.com': 'Xillio',
  'memsource.com': 'Memsource',
  'phrase.com': 'Phrase',
  'smartling.com': 'Smartling',
  'transifex.com': 'Transifex',
  'crowdin.com': 'Crowdin',
  'lokalise.com': 'Lokalise',
  'matecat.com': 'MateCat',
  'wordbee.com': 'Wordbee',
  'xtm-intl.com': 'XTM International',
  'globalese.com': 'Globalese',
  'lilt.com': 'Lilt',
  'modernmt.eu': 'ModernMT',
  'unbabel.com': 'Unbabel',
  'deepl.com': 'DeepL',
  'google.com': 'Google',
  'microsoft.com': 'Microsoft',
  'amazon.com': 'Amazon',
  'openai.com': 'OpenAI',
  'techcrunch.com': 'TechCrunch',
  'wired.com': 'Wired',
  'theverge.com': 'The Verge',
  'forbes.com': 'Forbes',
  'reuters.com': 'Reuters',
  'bloomberg.com': 'Bloomberg',
}

export function domainToPublisher(hostname: string): string {
  const clean = hostname.replace(/^www\./, '').toLowerCase()
  if (DOMAIN_PUBLISHER_MAP[clean]) return DOMAIN_PUBLISHER_MAP[clean]
  // Generic fallback: strip TLD, split on hyphens/dots, title-case each word
  const withoutTld = clean.replace(/\.[^.]+$/, '')
  return withoutTld
    .split(/[-.]/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

export function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(' ')
}

// Escapes text for safe placement inside XML element/attribute content.
// Shared by every RSS-emitting route (feed.xml, fact-flow/feed.xml, the
// generated feeds in lib/feedGenerator.ts).
export function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

// Estimated reading time from markdown content, ~200 words/minute.
export function estimateReadMinutes(content: string): number {
  const words = content.trim().split(/\s+/).length
  return Math.max(1, Math.round(words / 200))
}

// Returns the bare slug (last segment only) for use in article URLs.
// DB slugs are stored as "2026/06/04/article-name"; URLs use "/articles/article-name".
export function articleHref(slug: string): string {
  return `/articles/${slug.split('/').pop()}`
}

// Extracts 1-2 plain-text sentences from markdown content for use as a teaser.
export function extractTeaser(content: string, maxSentences = 2): string {
  const plain = content
    .replace(/```[\s\S]*?```/g, '')           // fenced code blocks
    .replace(/`[^`\n]+`/g, '')               // inline code
    .replace(/!\[.*?\]\(.*?\)/g, '')          // images
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links → keep text
    .replace(/^#{1,6}\s+/gm, '')             // headings
    .replace(/^[-*_]{3,}\s*$/gm, '')         // horizontal rules
    .replace(/^\s*[-*+]\s+/gm, '')           // unordered list items
    .replace(/^\s*\d+\.\s+/gm, '')           // ordered list items
    .replace(/[*_]{1,3}([^*_\n]+)[*_]{1,3}/g, '$1') // bold / italic
    .replace(/~~([^~\n]+)~~/g, '$1')         // strikethrough
    .replace(/<[^>]+>/g, '')                 // HTML tags
    .replace(/\n+/g, ' ')                   // newlines → space
    .trim()

  const result = splitSentences(plain).slice(0, maxSentences).join(' ').trim()
  return result || plain.slice(0, 140).trim()
}

// Abbreviations whose trailing period does not end a sentence.
const NON_TERMINAL_ABBREVIATIONS = new Set([
  'inc', 'ltd', 'co', 'corp', 'llc', 'plc', 'mr', 'mrs', 'ms', 'dr', 'prof', 'st',
  'jr', 'sr', 'vs', 'etc', 'approx', 'no',
])

// Splits plain text into sentences. A sentence ends only at . ! or ? followed
// by whitespace (or the end of the text), so decimals ("$3.5 billion"),
// version numbers ("GPT-4.1") and domains ("deepl.com") never split — and
// text is consumed left to right, so nothing before a boundary is ever
// dropped. Initials ("J. Smith"), dotted acronyms ("U.S.", "A.I.", "e.g.")
// and common abbreviations ("Inc.") are not treated as boundaries either.
export function splitSentences(text: string): string[] {
  const sentences: string[] = []
  const boundary = /[.!?]+["'\u201D\u2019)\]]*(?=\s|$)/g
  let start = 0
  let m: RegExpExecArray | null
  while ((m = boundary.exec(text)) !== null) {
    const end = m.index + m[0].length
    if (m[0].startsWith('.') && m[0].length === 1) {
      const word = text.slice(start, m.index).split(/\s+/).pop() ?? ''
      const bare = word.replace(/^["'\u201C\u2018(\[]+/, '').toLowerCase()
      if (/^([a-z]\.)*[a-z]$/.test(bare) || NON_TERMINAL_ABBREVIATIONS.has(bare)) continue
    }
    const sentence = text.slice(start, end).trim()
    if (sentence) sentences.push(sentence)
    start = end
  }
  return sentences
}

// Validates an admin-supplied image URL before it reaches an <img src>.
// Accepts absolute http(s) URLs and root-relative paths; everything else
// (javascript:, data:, malformed input) resolves to null so the layout simply
// falls back to the no-image rendering.
export function safeImageUrl(url: string | null | undefined): string | null {
  const trimmed = url?.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return trimmed
  try {
    const parsed = new URL(trimmed)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? trimmed : null
  } catch {
    return null
  }
}

// MIME type for an image URL, guessed from its extension. Used for RSS
// <enclosure> elements, which require a type attribute.
export function imageMimeType(url: string): string {
  const ext = url.split('?')[0].split('#')[0].split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'png': return 'image/png'
    case 'gif': return 'image/gif'
    case 'webp': return 'image/webp'
    case 'avif': return 'image/avif'
    case 'svg': return 'image/svg+xml'
    default: return 'image/jpeg'
  }
}
