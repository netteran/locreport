import Link from 'next/link'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Compass',
  description: 'Your navigation hub for market intelligence, tools, and the language technology landscape.',
  alternates: { canonical: '/compass' },
}

export default function CompassPage() {
  return (
    <div className="container" style={{ paddingTop: 'var(--space-8)', paddingBottom: 'var(--space-12)' }}>
      <section className="all-articles-hero">
        <h1>The Language Services &amp; AI Ecosystem Compass</h1>
        <p className="all-articles-subtitle">Your navigation hub for market intelligence, tools, and the language technology landscape.</p>
      </section>

      <div className="compass-grid">
        <Link href="/compass/locstock" className="compass-card">
          <div className="compass-card__icon">
            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <path d="M3 17l4-4 4 4 4-6 4 2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <span className="compass-card__badge">Live data</span>
          <p className="compass-card__title">LocStock</p>
          <p className="compass-card__subtitle">The Localization Market Index</p>
          <p className="compass-card__desc">Live equity overview of 38 publicly traded companies with exposure to language services, AI translation, and localization technology across 14 global exchanges.</p>
          <span className="compass-card__arrow">Explore →</span>
        </Link>

        <Link href="/compass/llm-pricing" className="compass-card">
          <div className="compass-card__icon">
            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <rect x="4" y="2" width="16" height="20" rx="2" fill="none" stroke="currentColor" strokeWidth="2"/>
              <line x1="8" y1="6" x2="16" y2="6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              <line x1="8" y1="10" x2="16" y2="10" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              <line x1="8" y1="14" x2="12" y2="14" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </div>
          <span className="compass-card__badge">Interactive</span>
          <p className="compass-card__title">AI Translation Cost Simulator</p>
          <p className="compass-card__subtitle">LLM Pricing Tool</p>
          <p className="compass-card__desc">Build your language programme pair by pair, set word volumes, and compare monthly API costs across GPT-5.5, Claude, Gemini, DeepSeek, Kimi, and more.</p>
          <span className="compass-card__arrow">Simulate →</span>
        </Link>

        <Link href="/compass/directory" className="compass-card">
          <div className="compass-card__icon">
            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <rect x="3" y="3" width="7" height="7" rx="1" fill="none" stroke="currentColor" strokeWidth="2"/>
              <rect x="14" y="3" width="7" height="7" rx="1" fill="none" stroke="currentColor" strokeWidth="2"/>
              <rect x="3" y="14" width="7" height="7" rx="1" fill="none" stroke="currentColor" strokeWidth="2"/>
              <rect x="14" y="14" width="7" height="7" rx="1" fill="none" stroke="currentColor" strokeWidth="2"/>
            </svg>
          </div>
          <span className="compass-card__badge">Searchable</span>
          <p className="compass-card__title">Language Technology Directory</p>
          <p className="compass-card__subtitle">100+ tools &amp; companies</p>
          <p className="compass-card__desc">Comprehensive directory of language technology tools — TMS platforms, CAT tools, AI translation engines, LSPs, interpreting platforms, and more.</p>
          <span className="compass-card__arrow">Search →</span>
        </Link>
      </div>
    </div>
  )
}
