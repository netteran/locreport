import { marked, type Token, type Tokens } from 'marked'
import { type ContentType } from './contentTaxonomy'
import { domainToPublisher } from './utils'

export const BRIEF_PROTOCOL = 'Write 200–450 words about one development. Name and link its original source naturally in the opening paragraph. Include a “Why this matters” heading with two or three concrete bullets. End with *Sources: [Source Name](exact supplied URL)*.'
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

function headingIndex(tokens: Token[], pattern: RegExp) {
  return tokens.findIndex(token => token.type === 'heading' && pattern.test(token.text.trim()))
}

const whyHeading = /^why this matters[.:]?$/i
const sourcesLine = /^\*Sources:\s[\s\S]+\*$/i
const genericAnchor = /^(?:sources?|here|links?|read more|click here|\d+)$/i

function briefParts(markdown: string) {
  const tokens = meaningfulTokens(markdown)
  const lead = tokens.find(token => token.type === 'paragraph')
  const heading = headingIndex(tokens, whyHeading)
  const takeaways = heading >= 0 ? tokens[heading + 1] : undefined
  return { lead, heading, takeaways, last: tokens.at(-1) }
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
    const { lead, takeaways, last } = briefParts(markdown)
    const matchesSource = (link: Tokens.Link) => sourceUrl(link.href)?.href === url.href && !genericAnchor.test(link.text.trim())
    if (!lead || !links([lead]).some(matchesSource)) {
      throw new Error('Name and link the original source in the opening paragraph of the brief.')
    }
    if (takeaways?.type !== 'list' || takeaways.ordered || takeaways.items.length < 2 || takeaways.items.length > 3
      || takeaways.items.some((item: Tokens.ListItem) => !item.text.trim())) {
      throw new Error('Add a “Why this matters” heading with two or three bullet points.')
    }
    const footnote = last?.type === 'paragraph' && sourcesLine.test(last.raw.trim()) ? links([last]) : []
    if (footnote.length !== 1 || !matchesSource(footnote[0])) {
      throw new Error('End the brief with *Sources: [Source Name](original URL)*.')
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

/** Older briefs use real saved evidence and takeaways without rewriting their original copy. */
export function presentBrief(markdown: string, originalSource: string | null, implications: string[]) {
  const { lead, heading, last } = briefParts(markdown)
  const source = sourceUrl(originalSource)
  let result = markdown.trimEnd()
  const note = last?.type === 'paragraph' && sourcesLine.test(last.raw.trim()) ? last.raw.trim() : null

  function escapeMarkdown(value: string) {
    return value.replace(/([\\`*_{}\[\]<>!#|])/g, '\\$1')
  }

  if (source) {
    const name = escapeMarkdown(domainToPublisher(source.hostname))
    const link = `[${name}](${source.href.replace(/\(/g, '%28').replace(/\)/g, '%29')})`
    if (lead && !links([lead]).some(item => sourceUrl(item.href)?.href === source.href)) {
      result = result.replace(lead.raw.trimEnd(), body => `${body} See ${link} for the original coverage.`)
    }
    if (!note || heading < 0) {
      const footer = note ?? `*Sources: ${link}*`
      if (note && result.endsWith(note)) result = result.slice(0, -note.length).trimEnd()
      if (heading < 0 && implications.length >= 2) {
        result += '\n\n## Why this matters\n\n' + implications.slice(0, 3).map(point => `- ${escapeMarkdown(point)}`).join('\n')
      }
      result += `\n\n${footer}`
    }
  }
  return result
}
