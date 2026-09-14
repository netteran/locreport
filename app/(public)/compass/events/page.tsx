import type { Metadata } from 'next'
import { createPublicClient } from '@/lib/supabase/server'
import { EVENTS, type Event } from '@/lib/data/events'
import { EventsClient } from './EventsClient'

export const revalidate = 3600

export const metadata: Metadata = {
  title: 'Industry Events 2026 | Compass',
  description: 'Upcoming localization, machine translation, and AI language conferences — from SlatorCon and LocWorld to ACL and NeurIPS.',
  alternates: { canonical: '/compass/events' },
}

async function getEvents(): Promise<Event[]> {
  try {
    const supabase = createPublicClient()
    const { data, error } = await supabase
      .from('events')
      .select('*')
      .order('start_date', { ascending: true })

    if (error || !data || data.length === 0) return EVENTS
    // Merge: DB events take precedence. A static event is excluded if any DB event
    // has the same slug (static event ids become slugs when migrated to DB).
    const dbSlugs = new Set(data.map((e: Event) => e.slug).filter(Boolean))
    const merged = [...data, ...EVENTS.filter(e => !dbSlugs.has(e.id))]
    merged.sort((a, b) => a.start_date.localeCompare(b.start_date))
    return merged as Event[]
  } catch {
    return EVENTS
  }
}

export default async function EventsPage() {
  const events = await getEvents()
  return (
    <div className="container" style={{ paddingTop: 'var(--space-8)', paddingBottom: 'var(--space-12)' }}>
      <h1>Industry Events 2026</h1>
      <p style={{ color: 'var(--muted)', marginBottom: 'var(--space-6)' }}>
        Upcoming localization, machine translation, and AI language conferences.
      </p>
      <EventsClient events={events} today={new Date().toISOString().slice(0, 10)} />
    </div>
  )
}
