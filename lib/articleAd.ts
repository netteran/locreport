import { load } from 'cheerio'

// Split only between complete top-level blocks, never inside lists, quotes,
// tables or other nested markup. Short articles keep their original HTML.
export function splitArticleForAd(html: string): { before: string; after: string } | null {
  const $ = load(html, {}, false)
  const blocks = $.root().contents()
  const paragraphs = blocks.toArray()
    .map((node, index) => node.type === 'tag' && node.name === 'p' ? index : -1)
    .filter(index => index >= 0)
  if (paragraphs.length < 2) return null
  const boundary = paragraphs[0] + 1
  return {
    before: blocks.slice(0, boundary).toString(),
    after: blocks.slice(boundary).toString(),
  }
}
