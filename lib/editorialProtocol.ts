import { marked, type Token, type Tokens } from 'marked'
import { type ContentType } from './contentTaxonomy'
import { domainToPublisher } from './utils'

export const BRIEF_PROTOCOL = 'Write 200–450 words about one development. Do not add a “Why this matters”, “Key takeaways” or similar bullet summary. End with *Sources: [Source Name](exact supplied URL)*.'
export const ANALYSIS_PROTOCOL = 'Aim for 600–1,500+ words when supported. Connect the evidence, explain market implications, and cite named sources naturally in body paragraphs. Avoid a generic source list at the end. A references list is appropriate for official multi-page documents or PDFs only.'

function sourceUrl(value: string | null | undefined): URL | null {
  try {
    const url = new URL(value ?? '')
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null
    url.hash = ''
    return url
  } catch {
    return null
  }
}

const TRACKING_PARAM = /^(?:utm_[a-z]+|fbclid|gclid|mc_cid|mc_eid|si|feature|ref)$/i

/**
 * A comparison key for "is this the same source?". Model-written links drift in
 * ways that don't change the destination: `www.`, a trailing slash, tracking
 * parameters, or YouTube's short `youtu.be/ID` form for `youtube.com/watch?v=ID`
 * (the Signal Room podcast briefs). Exact string equality rejected those.
 */
export function sourceKey(value: string | null | undefined): string | null {
  const url = sourceUrl(value)
  if (!url) return null
  const host = url.hostname.toLowerCase().replace(/^(?:www|m)\./, '')
  if (host === 'youtu.be' || host === 'youtube.com') {
    const id = host === 'youtu.be' ? url.pathname.slice(1).split('/')[0]
      : url.pathname === '/watch' ? url.searchParams.get('v')
      : url.pathname.match(/^\/(?:shorts|live|embed)\/([^/]+)/)?.[1]
    if (id) return `youtube:${id}`
  }
  const params = [...url.searchParams].filter(([key]) => !TRACKING_PARAM.test(key))
    .sort(([a], [b]) => a.localeCompare(b))
  const query = params.length ? '?' + new URLSearchParams(params).toString() : ''
  return `${host}${url.pathname.replace(/\/+$/, '')}${query}`
}

const sameSource = (href: string, key: string | null) => key !== null && sourceKey(href) === key

function links(tokens: Token[]) {
  const result: Tokens.Link[] = []
  marked.walkTokens(tokens, token => {
    if (token.type === 'link') result.push(token as Tokens.Link)
  })
  return result
}

function meaningfulTokens(markdown: string) {
  return marked.lexer(markdown).filter(token => token.type !== 'space' && token.type !== 'def')
}

const whyHeading = /^why this matters[.:]?$/i
const sourcesLine = /^\*Sources:\s[\s\S]+\*$/i
const genericAnchor = /^(?:sources?|here|links?|read more|click here|\d+)$/i

function briefParts(markdown: string) {
  const tokens = meaningfulTokens(markdown)
  const lead = tokens.find(token => token.type === 'paragraph')
  return { lead, last: tokens.at(-1) }
}

function words(markdown: string) {
  const body = markdown.replace(/^#\s[^\n]*\n?/m, '')
    .replace(/\]\(<[^>]+>\)/g, ']')
    .replace(/https?:\/\/[^\s]+/g, '')
  return body.match(/[\p{L}\p{N}]+(?:['’–-][\p{L}\p{N}]+)*/gu)?.length ?? 0
}

/** Check the structure at publication, independent of how a draft was written. */
export function validateEditorialProtocol(type: ContentType, markdown: string, originalSource?: string | null) {
  if (type === 'brief') {
    const url = sourceUrl(originalSource)
    if (!url) throw new Error('An industry brief needs one valid original source URL.')
    const key = sourceKey(url.href)
    // The source is credited by the closing Sources line. Linking it in the opening
    // paragraph is no longer required (owner's call, 2026-11-26).
    const { last } = briefParts(markdown)
    const matchesSource = (link: Tokens.Link) => sameSource(link.href, key) && !genericAnchor.test(link.text.trim())
    const footnote = last?.type === 'paragraph' && sourcesLine.test(last.raw.trim()) ? links([last]) : []
    if (footnote.length !== 1 || !matchesSource(footnote[0])) {
      throw new Error(`End the brief with *Sources: [Source Name](${url.href})*.`)
    }
    const count = words(markdown.slice(0, markdown.lastIndexOf(last!.raw.trim())))
    if (count < 200 || count > 450) throw new Error(`Keep industry briefs between 200 and 450 words. This brief has ${count} words.`)
  }

  if (type === 'analysis') {
    const tokens = meaningfulTokens(markdown)
    const last = tokens.at(-1)
    if (last?.type !== 'list') return
    const previous = tokens.at(-2)
    const namedSourceSection = previous?.type === 'heading' && /^(?:sources?|references|links|further reading)[.:]?$/i.test(previous.text.trim())
    const linkOnly = last.items.every((item: Tokens.ListItem) => {
      const cited = links(item.tokens)
      const remainder = cited.reduce((text, link) => text.replace(link.raw, ''), item.text)
      return cited.length > 0 && !/[\p{L}\p{N}]/u.test(remainder)
    })
    if (!namedSourceSection && !linkOnly) return
    const references = links([last])
    if (references.length && !references.every(link => /\.(?:pdf|docx?|odt)$/i.test(sourceUrl(link.href)?.pathname ?? ''))) {
      throw new Error('Place analysis citations naturally in body paragraphs. Reserve end lists for official documents.')
    }
  }
}

/**
 * Remove a "Why this matters" heading and the bullet list under it. Briefs used to
 * be required to carry one; the generic bullets read as automated aggregation, so
 * stored copy is cleaned at render time instead of rewriting the articles. A
 * heading followed by prose is real writing and is left alone.
 */
export function stripTakeaways(markdown: string) {
  const tokens = marked.lexer(markdown)
  let result = markdown
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (token.type !== 'heading' || !whyHeading.test(token.text.trim())) continue
    let next = i + 1
    while (tokens[next]?.type === 'space') next++
    const list = tokens[next]
    if (list?.type !== 'list') continue
    const from = result.indexOf(token.raw)
    const to = from < 0 ? -1 : result.indexOf(list.raw, from + token.raw.length)
    if (to < 0) continue
    result = `${result.slice(0, from).trimEnd()}\n\n${result.slice(to + list.raw.length).trimStart()}`.trim()
    i = next
  }
  return result
}

const escapeLinkText = (text: string) => text.replace(/([\\`*_{}\[\]<>!#|])/g, '\\$1')
const linkTarget = (url: URL) => url.href.replace(/\(/g, '%28').replace(/\)/g, '%29')

/**
 * Make a brief end with the *Sources: [Name](url)* line validateEditorialProtocol
 * requires. A generator is told to write it but doesn't always; this appends it
 * when missing (or replaces a Sources line that cites something else) and leaves
 * a brief that already has it untouched. The opening paragraph is never changed.
 */
export function ensureBriefSourcing(
  markdown: string,
  originalSource: string | null | undefined,
  sourceName?: string | null,
  { replaceFootnote = true }: { replaceFootnote?: boolean } = {},
) {
  const source = sourceUrl(originalSource)
  if (!source) return markdown
  const key = sourceKey(source.href)
  const name = sourceName?.trim() || domainToPublisher(source.hostname)
  const link = `[${escapeLinkText(name)}](${linkTarget(source)})`
  const credits = (found: Tokens.Link) => sameSource(found.href, key) && !genericAnchor.test(found.text.trim())
  const result = markdown.trimEnd()
  const { last } = briefParts(result)

  const footnote = last?.type === 'paragraph' && sourcesLine.test(last.raw.trim())
  if (!footnote) return `${result}\n\n*Sources: ${link}*`
  const cited = links([last])
  if (!replaceFootnote || (cited.length === 1 && credits(cited[0]))) return result
  const raw = last.raw.trim()
  return `${result.slice(0, result.lastIndexOf(raw)).trimEnd()}\n\n*Sources: ${link}*`
}

/** Briefs without a Sources line get one for their saved original source at render; the copy is not rewritten. */
export function presentBrief(markdown: string, originalSource: string | null) {
  const stripped = stripTakeaways(markdown)
  // Rendering never rewrites an existing Sources line: published copy may cite several.
  return sourceUrl(originalSource) ? ensureBriefSourcing(stripped, originalSource, null, { replaceFootnote: false }) : stripped
}
