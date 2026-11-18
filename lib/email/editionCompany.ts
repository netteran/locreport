import { Lexer, walkTokens } from 'marked'

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
        slug = url.pathname.match(/^\/compass\/directory\/([a-z0-9_-]+)\/?$/i)?.[1] || null
      } catch { /* A manually edited invalid URL cannot identify the current company. */ }
    })
    if (slug) return slug
  }
  return null
}
