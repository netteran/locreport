import { Lexer, marked, walkTokens } from 'marked'

/** Read the current spotlight from the editable company section, not other directory links. */
export function editionCompanySlug(markdown: string): string | null {
  let companySection = false
  for (const token of Lexer.lex(markdown)) {
    if (token.type === 'heading' && token.depth === 2) {
      companySection = token.text.trim().toLowerCase() === 'company of the week'
      continue
    }
    if (!companySection) continue
    let slug: string | null = null
    walkTokens([token], child => {
      if (slug || child.type !== 'link') return
      try {
        const url = new URL(child.href, 'https://locreport.com')
        if (!['https:', 'http:'].includes(url.protocol) || !['locreport.com', 'www.locreport.com'].includes(url.hostname)) return
        slug = url.pathname.match(/^\/(?:compass\/)?directory\/([a-z0-9_-]+)\/?$/i)?.[1] || null
      } catch { /* A manually edited invalid URL cannot identify the current company. */ }
    })
    if (slug) return slug
  }
  return null
}

/** Update one section without regenerating or rewriting the rest of the edition. */
export function replaceEditionCompany(markdown: string, section: string): string {
  return replaceEditionSection(markdown, section, ['company of the week'],
    ['fact flow', 'locstock', 'locstock brief', 'new in the directory', 'more from locreport', 'everything else this week'])
}

export function replaceEditionLocStock(markdown: string, section: string | null): string {
  return replaceEditionSection(markdown, section, ['locstock', 'locstock brief'],
    ['new in the directory', 'more from locreport', 'everything else this week'])
}

function replaceEditionSection(markdown: string, section: string | null, headings: string[], insertBefore: string[]): string {
  const body = markdown.replace(/\r\n?/g, '\n')
  // Marked can omit link definitions and expand leading tabs, so summing raw
  // token lengths would cut the original document at the wrong position.
  const tabs: { end: number; extra: number }[] = []
  let extra = 0
  body.replace(/^( *)(\t+)/gm, (match, _spaces, indent, offset) => {
    extra += indent.length * 3
    tabs.push({ end: offset + match.length + extra, extra })
    return match
  })
  const expandedLength = body.length + extra
  const positions: number[] = []
  let tabIndex = 0
  const tokens = Lexer.lex(body, {
    ...marked.getDefaults(),
    extensions: {
      renderers: {}, childTokens: {},
      block: [function (remaining, tokens) {
        if (tokens !== this.lexer.tokens) return
        const position = expandedLength - remaining.length
        while (tabIndex < tabs.length && tabs[tabIndex].end <= position) tabIndex++
        positions[tokens.length] = position - (tabs[tabIndex - 1]?.extra ?? 0)
        return undefined
      }],
    },
  })
  let sectionStart: number | undefined
  let nextBlock: number | undefined
  for (const [index, token] of tokens.entries()) {
    if (token.type !== 'heading' || token.depth > 2) continue
    const offset = positions[index]
    if (sectionStart !== undefined) return insertSection(body, sectionStart, offset, section)
    if (token.depth !== 2) continue
    const name = token.text.trim().toLowerCase()
    if (headings.includes(name)) sectionStart = offset
    else if (nextBlock === undefined && insertBefore.includes(name)) nextBlock = offset
  }
  if (section === null && sectionStart === undefined) return markdown
  const start = sectionStart ?? nextBlock ?? body.length
  return insertSection(body, start, sectionStart === undefined ? start : body.length, section)
}

function insertSection(body: string, start: number, end: number, section: string | null): string {
  const before = body.slice(0, start)
  const after = body.slice(end)
  if (section === null) return after ? before + after : before.trimEnd()
  const separator = before.endsWith('\n\n') || !before ? '' : before.endsWith('\n') ? '\n' : '\n\n'
  return before + separator + section + (after ? '\n\n' + after : '')
}
