import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { CATEGORY_SHORT, DIRECTORY, DIRECTORY_RENAMES } from '@/lib/data/directory'
import { createPublicClient } from '@/lib/supabase/server'
import { DirectoryLogo } from './DirectoryLogo'
import { AdminEditButton } from './AdminEditButton'
import { MarketCard } from './MarketCard'
import { locstockByDirectorySlug } from '@/lib/data/locstock'
import { getCompanyArticles, type CompanyArticle } from '@/lib/companyArticles'
import { articleHref } from '@/lib/utils'

export const revalidate = 3600

const CAT_DISPLAY = CATEGORY_SHORT

// Body-only mentions can run long (Slator is cited in 100+ articles), so the
// list is capped and the rest are a search away.
const MENTIONS_SHOWN = 10

// The note shown when this company is one half of a rename (see DIRECTORY_RENAMES).
function renameNote(slug: string) {
  const nameOf = (s: string) => DIRECTORY.find(e => e.slug === s)?.name ?? s
  const renamed = DIRECTORY_RENAMES.find(r => r.from === slug)
  if (renamed) {
    return { label: `Now ${nameOf(renamed.to)}`, note: renamed.note, href: `/compass/directory/${renamed.to}`, link: `See the ${nameOf(renamed.to)} profile` }
  }
  const formerly = DIRECTORY_RENAMES.find(r => r.to === slug)
  if (formerly) {
    return { label: `Formerly ${nameOf(formerly.from)}`, note: formerly.note, href: `/compass/directory/${formerly.from}`, link: `Earlier coverage is on the ${nameOf(formerly.from)} profile` }
  }
  return null
}

function ArticleList({ articles }: { articles: CompanyArticle[] }) {
  return (
    <ul className="dir-entry-articles">
      {articles.map(a => (
        <li key={a.id} className="dir-entry-article">
          <Link href={articleHref(a.slug)} className="dir-entry-article-title">{a.title}</Link>
          <span className="dir-entry-article-meta">
            <time dateTime={a.published_at}>
              {new Date(a.published_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </time>
            {a.publisher && <> · {a.publisher}</>}
          </span>
        </li>
      ))}
    </ul>
  )
}

async function getEntry(slug: string) {
  try {
    const supabase = createPublicClient()
    const { data, error } = await supabase
      .from('directory')
      .select('*')
      .eq('slug', slug)
      .single()
    if (!error && data) return data
  } catch {}
  return DIRECTORY.find(e => e.slug === slug) ?? null
}

export async function generateStaticParams() {
  return DIRECTORY.map(e => ({ slug: e.slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const entry = await getEntry(slug)
  if (!entry) return {}
  return {
    title: `${entry.name} | Language Technology Directory`,
    description: entry.description,
    alternates: { canonical: `/compass/directory/${slug}` },
  }
}

export default async function DirectoryEntryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const entry = await getEntry(slug)
  if (!entry) notFound()

  const catLabel = CAT_DISPLAY[entry.category] ?? entry.category
  const listed = locstockByDirectorySlug(entry.slug)
  const domain = entry.website.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  const logoUrl = `https://logo.clearbit.com/${domain}`
  const rename = renameNote(entry.slug)
  const { coverage, mentions } = await getCompanyArticles(createPublicClient(), entry.name)

  return (
    <div className="container" style={{ paddingTop: 'var(--space-8)', paddingBottom: 'var(--space-12)' }}>
      {/* Breadcrumb */}
      <div className="dir-breadcrumb-row">
        <nav className="dir-breadcrumb" aria-label="Breadcrumb">
          <Link href="/compass/directory" className="dir-breadcrumb-link">Directory</Link>
          <span className="dir-breadcrumb-sep" aria-hidden="true">›</span>
          <span className="dir-breadcrumb-current">{entry.name}</span>
        </nav>
        <AdminEditButton slug={entry.slug} />
      </div>

      {/* Hero */}
      <div className="dir-entry-hero">
        <div className="dir-entry-hero-main">
          <div className="dir-entry-header">
            <h1 className="dir-entry-name">{entry.name}</h1>
            <span className="dir-entry-cat">{catLabel}</span>
          </div>
          <p className="dir-entry-tagline">{entry.description}</p>
        </div>
        <div className="dir-entry-hero-aside">
          {/* Market tile — only for publicly listed companies tracked on LocStock */}
          {listed && <MarketCard company={listed} />}
          <DirectoryLogo domain={domain} name={entry.name} logoUrl={entry.logo_url} website={entry.website} />
        </div>
      </div>

      {rename && (
        <aside className="dir-entry-rename" aria-label="Company name change">
          <strong>{rename.label}.</strong> {rename.note}{' '}
          <Link href={rename.href} className="dir-entry-rename-link">{rename.link} →</Link>
        </aside>
      )}

      {/* Meta grid — Category | Type | Founded | HQ | Website, then Address full-width */}
      <div className="dir-entry-meta-grid">
        <div className="dir-entry-meta-item">
          <span className="dir-entry-meta-label">Category</span>
          <span className="dir-entry-meta-value">{catLabel}</span>
        </div>
        <div className="dir-entry-meta-item">
          <span className="dir-entry-meta-label">Type</span>
          <span className="dir-entry-meta-value">{entry.type}</span>
        </div>
        {entry.founded ? (
          <div className="dir-entry-meta-item">
            <span className="dir-entry-meta-label">Founded</span>
            <span className="dir-entry-meta-value">{entry.founded}</span>
          </div>
        ) : null}
        <div className="dir-entry-meta-item">
          <span className="dir-entry-meta-label">Headquarters</span>
          <span className="dir-entry-meta-value">{entry.hq}</span>
        </div>
        <div className="dir-entry-meta-item">
          <span className="dir-entry-meta-label">Website</span>
          <a
            href={entry.website}
            target="_blank"
            rel="noopener"
            className="dir-entry-meta-link"
          >
            {entry.website.replace(/^https?:\/\//, '')}
          </a>
        </div>
        {entry.address && (
          <div className="dir-entry-meta-item dir-entry-meta-full">
            <span className="dir-entry-meta-label">Address</span>
            <span className="dir-entry-meta-value">{entry.address}</span>
          </div>
        )}
      </div>

      {/* About */}
      <div className="dir-entry-body">
        <h2 className="dir-entry-section-title">About {entry.name}</h2>
        <p className="dir-entry-long-desc">{entry.long_description || entry.description}</p>
      </div>

      {/* Tags */}
      {entry.tags && entry.tags.length > 0 && (
        <div className="dir-entry-tags">
          {entry.tags.map((tag: string) => (
            <span key={tag} className="dir-entry-tag">{tag}</span>
          ))}
        </div>
      )}

      {/* Articles naming the company — headline coverage first, passing mentions after */}
      {coverage.length > 0 && (
        <section className="dir-entry-coverage" aria-label={`LocReport coverage of ${entry.name}`}>
          <h2 className="dir-entry-section-title">
            {entry.name} in the news <span className="dir-entry-count">{coverage.length}</span>
          </h2>
          <ArticleList articles={coverage} />
        </section>
      )}
      {mentions.length > 0 && (
        <section className="dir-entry-coverage" aria-label={`Other articles mentioning ${entry.name}`}>
          <h2 className="dir-entry-section-title">
            Also mentioned in <span className="dir-entry-count">{mentions.length}</span>
          </h2>
          <ArticleList articles={mentions.slice(0, MENTIONS_SHOWN)} />
          {mentions.length > MENTIONS_SHOWN && (
            <Link href={`/search?q=${encodeURIComponent(entry.name)}`} className="dir-entry-more">
              Search all articles mentioning {entry.name} →
            </Link>
          )}
        </section>
      )}

      {/* Back link */}
      <div style={{ marginTop: 'var(--space-8)' }}>
        <Link href="/compass/directory" className="dir-entry-back">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
          Back to directory
        </Link>
      </div>
    </div>
  )
}
