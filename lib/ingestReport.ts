export interface IngestSourceResult {
  id: string
  name: string
  status: 'ok' | 'error' | 'deferred'
  items: number
  old: number
  invalid: number
  seen: number
  keyword_misses: number
  short_text: number
  unusable: number
  collected: number
  failed: number
  deferred: number
  error?: string
  rejections: { url: string; reason: 'short_text' | 'unusable' }[]
}

export function sourceResult(source: { id: string; name?: string; url: string }): IngestSourceResult {
  let fallbackName = source.id
  try { fallbackName = new URL(source.url).hostname } catch { /* Keep malformed feed URLs out of workflow output. */ }
  return { id: source.id, name: source.name || fallbackName, status: 'ok', items: 0,
    old: 0, invalid: 0, seen: 0, keyword_misses: 0, short_text: 0, unusable: 0,
    collected: 0, failed: 0, deferred: 0, rejections: [] }
}
