import type { SupabaseClient } from '@supabase/supabase-js'
import { type DirectoryEntry } from '@/lib/data/directory'
import { fetchDirectoryEntries } from '@/lib/directory'

// Directory entries are seeded from lib/data/directory.ts and overridden by the
// Supabase directory table — same merge used by /directory and
// /api/directory, so linkified mentions cover every company either layer knows.
export async function getDirectoryEntries(supabase: SupabaseClient): Promise<DirectoryEntry[]> {
  return fetchDirectoryEntries(supabase)
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Segments that must never be touched: fenced/inline code, existing markdown
// links/images, and headings (name matches there tend to be noise, e.g. a
// heading that IS the company name).
const SPLIT_ON_PROTECTED = /(```[\s\S]*?```|`[^`]*`|!\[[^\]]*\]\([^)]*\)|\[[^\]]*\]\([^)]*\)|^#{1,6}\s.*$)/gm

function isProtectedSegment(segment: string): boolean {
  return (
    segment.startsWith('```') ||
    (segment.startsWith('`') && segment.endsWith('`')) ||
    segment.startsWith('![') ||
    segment.startsWith('[') ||
    /^#{1,6}\s/.test(segment)
  )
}

/**
 * Scans markdown body text for mentions of companies in the tech directory and
 * links the first mention of each one to its /directory/[slug] page.
 * Longer, more specific names (e.g. "Google Translate") are matched before
 * shorter ones (e.g. "Google") so they aren't partially shadowed.
 */
export function linkifyCompanyMentions(markdown: string, entries: DirectoryEntry[]): string {
  const candidates = entries
    .filter(e => e.name?.trim() && e.slug?.trim())
    .sort((a, b) => b.name.length - a.name.length)

  if (candidates.length === 0) return markdown

  const nameToSlug = new Map(candidates.map(e => [e.name, e.slug]))
  const namePattern = new RegExp(`\\b(${candidates.map(e => escapeRegExp(e.name)).join('|')})\\b`, 'g')

  const linkedSlugs = new Set<string>()

  return markdown
    .split(SPLIT_ON_PROTECTED)
    .map(segment => {
      if (isProtectedSegment(segment)) return segment
      return segment.replace(namePattern, match => {
        const slug = nameToSlug.get(match)
        if (!slug || linkedSlugs.has(slug)) return match
        linkedSlugs.add(slug)
        return `[${match}](/directory/${slug})`
      })
    })
    .join('')
}
