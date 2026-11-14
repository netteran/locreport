import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = {
  title: 'About',
  description: 'About LocReport — an independent publication tracking the pulse of the language services industry.',
  alternates: {
    canonical: 'https://locreport.com/about',
  },
}

export default function AboutPage() {
  return (
    <div className="container" style={{ paddingTop: 'var(--space-8)', paddingBottom: 'var(--space-12)' }}>
      <article className="page-prose">
        <h1>About LocReport</h1>

        <p>LocReport is an independent publication portal tracking the pulse of the language services industry.</p>

        <p>We cover daily developments in translation, localization, global content strategy, language technology, and cross-border communication. From emerging AI tools to market shifts and operational innovation, our goal is simple:</p>

        <blockquote>Capture the trends, movements, and ideas shaping the future of global communication.</blockquote>

        <p>The language services industry evolves quickly. New platforms emerge. Workflows transform. Technology redefines what's possible. LocReport exists to observe, document, and analyze those changes with clarity and perspective.</p>

        <h2>Why This Exists</h2>

        <p>LocReport is an experimental publishing project.</p>

        <p>It was created to explore a focused, signal-over-noise approach to industry reporting — short, relevant, and structured coverage without hype or clutter.</p>

        <p>We are testing formats, tone, and frequency while building a resource that professionals in localization and translation can rely on.</p>

        <h2>Behind LocReport</h2>

        <p>LocReport was founded by Adam Parasion, a localization professional with over twenty years of experience spanning project delivery, program management, and operational leadership in the language services industry.</p>

        <p>His career has taken him from hands-on localization project management to leading teams and overseeing complex programs for global enterprise clients. That experience brings a practitioner’s perspective to industry coverage: an understanding of how people, processes, technology, and business priorities come together to deliver multilingual content at scale.</p>

        <p>LocReport grew from that professional journey, a lifelong commitment to learning, and a passion for an industry that connects the world through language. The project exists at the intersection of professional knowledge, editorial craft, and emerging technology, with a particular curiosity about how AI and automation are reshaping the work behind global communication.</p>

        <p>It is an experiment in what industry intelligence can look like when grounded in firsthand experience, shaped by thoughtful inquiry, and open to new perspectives. Its ambition is to follow the industry as an informed participant, asking questions about where it is headed and what its evolution means for the people within it.</p>

        <p>In that spirit, LocReport reflects both a professional journey and an ongoing commitment: to build something useful, honest, and persistently curious about the future of global communication.</p>

        <h2>Contribute</h2>

        <p>This project is open and evolving.</p>

        <p>If you:</p>
        <ul>
          <li>Work in translation, localization, or language technology</li>
          <li>Have insights on industry trends</li>
          <li>Want to share analysis, commentary, or curated news</li>
          <li>Or simply believe this industry deserves sharper reporting</li>
        </ul>

        <p>We welcome contributions. <Link href="/contact">Reach out through the Contact page</Link> and tell us what you'd like to share.</p>

        <p>LocReport is about tracking what drives global communication — and the people building it.</p>
      </article>
    </div>
  )
}
