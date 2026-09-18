import type { Metadata } from 'next'
import Link from 'next/link'
import { Nav } from '@/components/Nav'

export const metadata: Metadata = {
  title: 'Page Not Found',
  description: 'The page you are looking for does not exist. Explore LocReport for the latest in translation, localization, and language technology.',
  robots: { index: false, follow: true },
}

const LINKS = [
  {
    href: '/articles',
    label: 'Latest Articles',
    desc: 'Daily coverage of translation, AI, and localization industry developments.',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      </svg>
    ),
  },
  {
    href: '/intelligence',
    label: 'Intelligence',
    desc: 'Active signals tracking structural shifts across the language services market.',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    ),
  },
  {
    href: '/reports/monthly',
    label: 'Monthly Reports',
    desc: 'Curated monthly synthesis of the most important industry movements.',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
      </svg>
    ),
  },
  {
    href: '/compass',
    label: 'Compass',
    desc: 'LocStock, LLM pricing, and industry directory — all in one place.',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="10" /><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
      </svg>
    ),
  },
  {
    href: '/intelligence/high-impact',
    label: 'High-Impact News',
    desc: 'The most consequential stories filtered by impact score.',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
      </svg>
    ),
  },
  {
    href: '/about',
    label: 'About LocReport',
    desc: 'An independent publication tracking the pulse of global language services.',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
    ),
  },
]

export default function NotFound() {
  return (
    <>
      <Nav />
      <style>{`
        /* ── hero ── */
        .nf-hero {
          padding: var(--space-10) var(--page-gutter) var(--space-8);
          text-align: center;
          border-bottom: 1px solid var(--border);
        }
        .nf-hero-badge {
          display: inline-block;
          margin-bottom: var(--space-4);
          font-family: var(--font-mono); font-size: 0.72rem;
          color: var(--muted); letter-spacing: 0.1em; font-weight: 500;
          text-transform: uppercase;
        }
        .nf-hero h1 {
          font-family: var(--font-display); font-weight: 600;
          font-size: clamp(1.9rem, 4.5vw, 2.75rem); line-height: 1.15;
          color: var(--text); margin: 0 0 var(--space-4);
          letter-spacing: -0.02em;
        }
        .nf-hero-sub {
          font-size: 1.02rem; color: var(--muted);
          margin: 0 0 var(--space-6); line-height: 1.6;
          max-width: 480px; margin-inline: auto; margin-bottom: var(--space-6);
        }
        .nf-hero-btn-secondary {
          display: inline-flex; align-items: center; gap: 0.45rem;
          background: transparent; color: var(--text);
          border: 1px solid var(--border);
          padding: 0.6rem 1.4rem; border-radius: var(--radius-md);
          font-weight: 500; font-size: 0.95rem;
        }
        /* ── cards ── */
        .nf-card {
          display: flex; align-items: flex-start; gap: 1rem;
          background: var(--surface); border: 1px solid var(--border);
          border-radius: var(--radius-lg); padding: 1.25rem 1.4rem;
          text-decoration: none;
          transition: border-color 0.2s;
        }
        .nf-card:hover {
          border-color: var(--accent);
        }
      `}</style>
      <main style={{ minHeight: '80vh', background: 'var(--bg)', paddingBottom: 'var(--space-16)' }}>

        {/* Hero band */}
        <section className="nf-hero">
          <div style={{ maxWidth: 'var(--content-width)', margin: '0 auto' }}>
            <div className="nf-hero-badge">
              <span>Error 404</span>
            </div>

            <h1>Lost in translation&hellip;?</h1>

            <p className="nf-hero-sub">
              This page doesn&rsquo;t exist — or it may have moved as the industry evolves. The language services world shifts fast; apparently so do URLs.
            </p>

            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', flexWrap: 'wrap' }}>
              <Link href="/" style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.45rem',
                background: 'var(--accent)', color: '#fff',
                padding: '0.6rem 1.4rem', borderRadius: 'var(--radius-md)',
                fontWeight: 600, fontSize: '0.95rem',
              }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
                Back to home
              </Link>
              <Link href="/articles" className="nf-hero-btn-secondary">
                Browse articles
              </Link>
            </div>
          </div>
        </section>

        {/* Navigation grid */}
        <section style={{
          maxWidth: 'var(--site-max-width)', margin: '0 auto',
          padding: 'var(--space-10) var(--page-gutter) 0',
        }}>
          <p style={{
            fontFamily: 'var(--font-display)', fontWeight: 600,
            fontSize: '0.8rem', letterSpacing: '0.08em', textTransform: 'uppercase',
            color: 'var(--muted)', marginBottom: 'var(--space-5)',
          }}>
            Where would you like to go?
          </p>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 'var(--space-4)',
          }}>
            {LINKS.map(({ href, label, desc, icon }) => (
              <Link key={href} href={href} className="nf-card">
                <span style={{
                  flexShrink: 0, width: '40px', height: '40px',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--accent-soft)',
                  color: 'var(--accent)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {icon}
                </span>
                <span>
                  <span style={{
                    display: 'block', fontWeight: 600, fontSize: '0.95rem',
                    color: 'var(--text)', marginBottom: '0.25rem',
                    fontFamily: 'var(--font-display)',
                  }}>
                    {label}
                  </span>
                  <span style={{ fontSize: '0.85rem', color: 'var(--muted)', lineHeight: 1.55 }}>
                    {desc}
                  </span>
                </span>
              </Link>
            ))}
          </div>
        </section>

        {/* Search nudge */}
        <section style={{
          maxWidth: 'var(--site-max-width)', margin: '0 auto',
          padding: 'var(--space-8) var(--page-gutter) 0',
        }}>
          <div style={{
            background: 'var(--bg-secondary)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-xl)', padding: 'var(--space-6) var(--space-6)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: 'var(--space-4)', flexWrap: 'wrap',
          }}>
            <div>
              <p style={{ fontWeight: 600, fontSize: '1rem', color: 'var(--text)', margin: 0, fontFamily: 'var(--font-display)' }}>
                Looking for something specific?
              </p>
              <p style={{ fontSize: '0.875rem', color: 'var(--muted)', margin: '0.25rem 0 0' }}>
                Use site search to find articles, signals, and reports by keyword.
              </p>
            </div>
            <Link href="/search" style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
              background: 'var(--accent)', color: '#fff',
              padding: '0.55rem 1.2rem', borderRadius: 'var(--radius-md)',
              fontWeight: 600, fontSize: '0.9rem', whiteSpace: 'nowrap',
            }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              Search LocReport
            </Link>
          </div>
        </section>

      </main>
    </>
  )
}
