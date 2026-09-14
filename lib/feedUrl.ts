import { SITE_URL } from '@/lib/seo'

// The public URL a generated feed is served at. Shared so the XML's atom:link,
// the admin "Add to Sources" button and any rss_sources row all agree —
// ingest fetches this absolute URL server-side, so it can never be
// window.location-derived.
export function feedUrl(name: string): string {
  return `${SITE_URL}/api/feeds/${encodeURIComponent(name)}`
}
