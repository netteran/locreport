'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { ADMIN_LINKS, ARTICLE_LINKS, OTHER_ARTICLE_LINKS, activeAdminLink } from '@/lib/adminNav'
export function AdminAreaNav() {
  const pathname = usePathname()
  const area = activeAdminLink(pathname)
  // Editor topics that have gathered enough evidence to write. Purely informational: a failed
  // request (or the topics migration not yet applied) simply shows no badge.
  const [readyTopics, setReadyTopics] = useState(0)
  useEffect(() => {
    let live = true
    fetch('/api/topics?summary=1').then(r => r.ok ? r.json() : null)
      .then(d => { if (live && d) setReadyTopics(d.ready || 0) }).catch(() => {})
    return () => { live = false }
  }, [pathname])
  return <>
    <nav className="admin-area-nav" aria-label="Admin areas">{ADMIN_LINKS.map(link =>
      <Link key={link.href} href={link.href} aria-current={area.href === link.href ? 'page' : undefined}>{link.label}
        {link.href === '/admin/candidates' && readyTopics > 0 &&
          <span className="admin-badge" title={`${readyTopics} topic${readyTopics === 1 ? '' : 's'} ready to write`}>{readyTopics}</span>}
      </Link>
    )}</nav>
    {area.href === '/admin/candidates' && <div className="admin-workflow">
      <p>Feed generation → Sources → Candidates &amp; suggested articles → Review → Publish</p>
      <nav aria-label="Article workflow">{ARTICLE_LINKS.map(link => <Link key={link.href} href={link.href}
        aria-current={pathname === link.href || pathname.startsWith(`${link.href}/`) ? 'page' : undefined}>{link.label}</Link>)}
        <details open={OTHER_ARTICLE_LINKS.some(link => pathname === link.href) || undefined}><summary>Other options</summary>
          {OTHER_ARTICLE_LINKS.map(link => <Link key={link.href} href={link.href}>{link.label}</Link>)}
        </details>
      </nav>
    </div>}
    {area.href === '/admin/weekly' && <nav className="admin-subnav" aria-label="Newsletter pages"><Link href="/admin/weekly">Current edition</Link><Link href="/admin/digest-history">Sent editions</Link></nav>}
    {area.href === '/admin/monthly' && <nav className="admin-subnav" aria-label="Monthly briefing pages"><Link href="/admin/monthly">Create &amp; review</Link><Link href="/admin/reports">Briefings &amp; report images</Link><Link href="/reports/">Published briefings ↗</Link></nav>}
  </>
}
