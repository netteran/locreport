import type { Metadata } from 'next'
import Link from 'next/link'
import { CONTENT_TAXONOMY } from '@/lib/contentTaxonomy'

export const metadata: Metadata = {
  title: 'About',
  description: 'Learn how LocReport covers localization, language services and AI through industry briefs, analysis, reports and sourced Fact Flow updates.',
  alternates: {
    canonical: 'https://locreport.com/about',
  },
}

export default function AboutPage() {
  return (
    <div className="container" style={{ paddingTop: 'var(--space-8)', paddingBottom: 'var(--space-12)' }}>
      <article className="page-prose">
        <h1>About LocReport</h1>

        <p>LocReport is an independent publication covering localization, language services and AI.</p>

        <p>We follow developments in translation, global content strategy and language technology, with a practitioner’s perspective on what they mean for people working in the industry.</p>

        <h2>How we cover the industry</h2>

        <p>The <Link href="/">homepage</Link> brings briefs, analysis and reports into one feed, newest first. Use the filters to browse a single format.</p>

        <ul>
          <li><Link href={CONTENT_TAXONOMY.brief.path}>Briefs</Link> cover appointments, product launches and events. Each credits its source and explains why the development matters.</li>
          <li><Link href={CONTENT_TAXONOMY.analysis.path}>Analysis</Link> connects evidence and industry context to explain market implications.</li>
          <li><Link href={CONTENT_TAXONOMY.report.path}>Reports</Link> include monthly roundups of what changed and what to watch next, alongside annual market research.</li>
        </ul>

        <p><Link href="/fact-flow">Fact Flow</Link> tracks ongoing industry news and links to original sources.</p>

        <h2>Industry tools</h2>

        <p>Browse the <Link href="/directory">Directory</Link> to find language services and technology providers. Follow publicly traded companies on <Link href="/locstock">LocStock</Link>.</p>

        <h2>Behind LocReport</h2>

        <p>LocReport was founded by Adam Parasion, a localization professional with over twenty years of experience spanning project delivery, program management, and operational leadership in the language services industry.</p>

        <p>His career has taken him from hands-on localization project management to leading teams and overseeing complex programs for global enterprise clients. That experience brings a practitioner’s perspective to industry coverage: an understanding of how people, processes, technology, and business priorities come together to deliver multilingual content at scale.</p>

        <p>LocReport grew from that professional journey, a lifelong commitment to learning, and a passion for an industry that connects the world through language. The project exists at the intersection of professional knowledge, editorial craft, and emerging technology, with a particular curiosity about how AI and automation are reshaping the work behind global communication.</p>

        <p>It is an experiment in what industry publishing can look like when grounded in firsthand experience, shaped by thoughtful inquiry, and open to new perspectives. Its ambition is to follow the industry as an informed participant, asking questions about where it is headed and what its evolution means for the people within it.</p>

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
