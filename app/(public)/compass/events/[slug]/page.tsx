import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { EVENTS, type Event } from '@/lib/data/events'
import { createPublicClient } from '@/lib/supabase/server'

export const revalidate = 3600

const MONTHS_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December']
const FORMAT_LABEL: Record<string, string> = { 'in-person': 'In-person', online: 'Online', hybrid: 'Hybrid' }
const CAT_LABEL: Record<string, string> = { conference: 'Conference', summit: 'Summit' }

function formatDateRange(start: string, end: string): string {
  const s = new Date(start + 'T12:00:00Z')
  const e = new Date(end + 'T12:00:00Z')
  const sm = MONTHS_FULL[s.getUTCMonth()]
  const sd = s.getUTCDate()
  const sy = s.getUTCFullYear()
  if (start === end) return `${sm} ${sd}, ${sy}`
  const em = MONTHS_FULL[e.getUTCMonth()]
  const ed = e.getUTCDate()
  const ey = e.getUTCFullYear()
  if (sm === em && sy === ey) return `${sm} ${sd}–${ed}, ${sy}`
  if (sy === ey) return `${sm} ${sd} – ${em} ${ed}, ${sy}`
  return `${sm} ${sd}, ${sy} – ${em} ${ed}, ${ey}`
}

async function getEvent(slug: string): Promise<Event | null> {
  try {
    const supabase = createPublicClient()
    // Try slug column first (DB-created events), then id (static events merged into DB)
    const { data: bySlug } = await supabase.from('events').select('*').eq('slug', slug).maybeSingle()
    if (bySlug) return bySlug as Event
    const { data: byId } = await supabase.from('events').select('*').eq('id', slug).maybeSingle()
    if (byId) return byId as Event
  } catch {}
  return EVENTS.find(e => e.id === slug) ?? null
}

export async function generateStaticParams() {
  return EVENTS.map(e => ({ slug: e.id }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const ev = await getEvent(slug)
  if (!ev) return {}
  return {
    title: `${ev.name} | Industry Events`,
    description: ev.description,
    alternates: { canonical: `/compass/events/${slug}` },
  }
}

export default async function EventDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const ev = await getEvent(slug)
  if (!ev) notFound()

  const today = new Date().toISOString().slice(0, 10)
  const isPast = ev.end_date < today

  return (
    <div className="container" style={{ paddingTop: 'var(--space-8)', paddingBottom: 'var(--space-12)' }}>
      {/* Breadcrumb */}
      <nav className="dir-breadcrumb" aria-label="Breadcrumb" style={{ marginBottom: 'var(--space-6)' }}>
        <Link href="/compass" className="dir-breadcrumb-link">Compass</Link>
        <span className="dir-breadcrumb-sep" aria-hidden="true">›</span>
        <Link href="/compass/events" className="dir-breadcrumb-link">Events</Link>
        <span className="dir-breadcrumb-sep" aria-hidden="true">›</span>
        <span className="dir-breadcrumb-current">{ev.name}</span>
      </nav>

      {/* Hero */}
      <div style={{ marginBottom: 'var(--space-6)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap', marginBottom: 'var(--space-3)' }}>
          <span className={`event-badge event-badge--${ev.category}`}>{CAT_LABEL[ev.category] ?? ev.category}</span>
          <span style={{ fontSize: '0.78rem', fontWeight: 600, padding: '2px 8px', background: 'var(--bg-secondary)', borderRadius: '100px', color: 'var(--muted)', border: '1px solid var(--border)' }}>
            {FORMAT_LABEL[ev.format] ?? ev.format}
          </span>
          {isPast && (
            <span style={{ fontSize: '0.78rem', fontWeight: 600, padding: '2px 8px', background: 'var(--bg-secondary)', borderRadius: '100px', color: 'var(--muted)', border: '1px solid var(--border)' }}>
              Past event
            </span>
          )}
        </div>
        <h1 style={{ fontSize: 'clamp(1.6rem, 4vw, 2.4rem)', fontWeight: 700, lineHeight: 1.15, marginBottom: 'var(--space-2)', color: 'var(--text)' }}>
          {ev.name}
        </h1>
        <p style={{ fontSize: '1.05rem', color: 'var(--muted)', marginBottom: 0 }}>{ev.organizer}</p>
      </div>

      {/* Meta grid */}
      <div className="dir-entry-meta-grid" style={{ marginBottom: 'var(--space-8)' }}>
        <div className="dir-entry-meta-item">
          <span className="dir-entry-meta-label">Date</span>
          <span className="dir-entry-meta-value">{formatDateRange(ev.start_date, ev.end_date)}</span>
        </div>
        <div className="dir-entry-meta-item">
          <span className="dir-entry-meta-label">Location</span>
          <span className="dir-entry-meta-value">{ev.location || '—'}</span>
        </div>
        <div className="dir-entry-meta-item">
          <span className="dir-entry-meta-label">Format</span>
          <span className="dir-entry-meta-value">{FORMAT_LABEL[ev.format] ?? ev.format}</span>
        </div>
        <div className="dir-entry-meta-item">
          <span className="dir-entry-meta-label">Organizer</span>
          <span className="dir-entry-meta-value">{ev.organizer || '—'}</span>
        </div>
        {ev.url && (
          <div className="dir-entry-meta-item">
            <span className="dir-entry-meta-label">Website</span>
            <a href={ev.url} target="_blank" rel="noopener" className="dir-entry-meta-link">
              {ev.url.replace(/^https?:\/\//, '').replace(/\/$/, '')}
            </a>
          </div>
        )}
      </div>

      {/* Description */}
      <div className="dir-entry-body" style={{ marginBottom: 'var(--space-6)' }}>
        <h2 className="dir-entry-section-title">About {ev.name}</h2>
        <p className="dir-entry-long-desc">{ev.description}</p>
      </div>

      {/* Tags */}
      {ev.tags && ev.tags.length > 0 && (
        <div className="dir-entry-tags" style={{ marginBottom: 'var(--space-8)' }}>
          {ev.tags.map(tag => (
            <span key={tag} className="dir-entry-tag">{tag}</span>
          ))}
        </div>
      )}

      {/* CTA */}
      {ev.url && (
        <div style={{ marginBottom: 'var(--space-8)' }}>
          <a
            href={ev.url}
            target="_blank"
            rel="noopener"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '10px 20px',
              background: 'var(--accent)',
              color: '#fff',
              borderRadius: 'var(--radius-md)',
              fontWeight: 600,
              fontSize: '0.9rem',
              textDecoration: 'none',
            }}
          >
            Visit official website
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/>
            </svg>
          </a>
        </div>
      )}

      {/* Back link */}
      <Link href="/compass/events" className="dir-entry-back">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
        Back to events
      </Link>
    </div>
  )
}
