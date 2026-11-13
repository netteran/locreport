import { createHash } from 'node:crypto'
import type { EventDescriptor } from './researchTypes'

/** Preserve meaningful parameters; only remove known tracking fields. */
export function canonicalSourceUrl(raw: string): string {
  const url = new URL(raw)
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('HTTP(S) source URL required')
  url.hash = ''
  for (const key of [...url.searchParams.keys()]) {
    if (/^utm_|^(fbclid|gclid|mc_cid|mc_eid)$/i.test(key)) url.searchParams.delete(key)
  }
  url.searchParams.sort()
  url.pathname = url.pathname.replace(/\/$/, '') || '/'
  return url.toString()
}

export function normalizeEntity(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(holdings?|group|incorporated|inc|limited|ltd|plc|corp|corporation|llc)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Stage is essential: an announced deal and its completion are different news. */
export function eventIdentity(event: EventDescriptor, sourceDate?: string | null): string {
  const year = (event.event_date || sourceDate || '').slice(0, 4) || 'undated'
  return createHash('sha256')
    .update(
      [
        normalizeEntity(event.subject),
        normalizeEntity(event.action),
        normalizeEntity(event.object),
        normalizeEntity(event.stage),
        year
      ].join('|')
    )
    .digest('hex')
}

export function parseDescriptor(value: unknown): EventDescriptor {
  if (!value || typeof value !== 'object') throw new Error('Invalid event extraction')
  const v = value as Record<string, unknown>
  const strings = (key: string) =>
    Array.isArray(v[key])
      ? (v[key] as unknown[])
          .filter((s): s is string => typeof s === 'string' && s.length < 200)
          .slice(0, 12)
      : []
  const field = (key: string) =>
    typeof v[key] === 'string' ? String(v[key]).trim().slice(0, 500) : ''
  const newsworthy = v.newsworthy === true
  const event = {
    subject: field('subject'),
    action: field('action'),
    object: field('object'),
    stage: field('stage'),
    event_date: /^\d{4}-\d{2}-\d{2}$/.test(field('event_date')) ? field('event_date') : null,
    headline: field('headline') || null,
    newsworthy,
    entities: strings('entities'),
    topics: strings('topics')
  }
  if (
    newsworthy &&
    (!event.subject || !event.action || !event.object || !event.stage || !event.headline)
  ) {
    throw new Error('News event is missing its identity or headline')
  }
  if (
    event.event_date &&
    (!Number.isFinite(Date.parse(event.event_date)) ||
      new Date(event.event_date).toISOString().slice(0, 10) !== event.event_date)
  ) {
    throw new Error('Event date is not a valid calendar date')
  }
  if (
    newsworthy &&
    (![
      'acquisition',
      'product_launch',
      'appointment',
      'funding',
      'partnership',
      'financial_results',
      'regulation',
      'research',
      'conference',
      'other'
    ].includes(event.action) ||
      !['announced', 'completed', 'approved', 'launched', 'reported'].includes(event.stage))
  ) {
    throw new Error('Unrecognized event action or stage; review the source')
  }
  return event
}

export function mayAutoPublish(
  event: EventDescriptor,
  sourceDate: string | null,
  quality: string,
  now = Date.now()
) {
  if (!event.newsworthy || !event.headline || quality === 'snippet') return false
  const date = event.event_date || sourceDate
  if (!date) return false
  const age = now - Date.parse(date)
  return Number.isFinite(age) && age >= -86400000 && age <= 42 * 86400000
}

export function validateSourceCitations(content: string, urls: string[]) {
  const allowed = new Set(urls.map(canonicalSourceUrl))
  if (!allowed.size) throw new Error('Article requires at least one selected source')
  const used = new Set<string>()
  for (const match of content.matchAll(/\[[^\]]+\]\((https?:\/\/[^\s)]+)\)/g)) {
    const url = canonicalSourceUrl(match[1])
    if (!allowed.has(url))
      throw new Error('Generated article cites a source outside the selected evidence')
    used.add(url)
  }
  return used
}
