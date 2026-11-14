'use client'

import Link from 'next/link'
import { AdminArrow } from '@/components/AdminArrow'
import { usePathname } from 'next/navigation'
import { ADMIN_GROUPS, activeAdminLink } from '@/lib/adminNav'

export function AdminNavigation() {
  const pathname = usePathname()
  const active = activeAdminLink(pathname)

  function navigation() {
    return (
      <>
        <Link href="/admin" className="admin-nav__link admin-nav__dashboard"
          aria-current={active.href === '/admin' ? 'page' : undefined}>Dashboard</Link>
        {ADMIN_GROUPS.map(group => (
          <div className="admin-nav__group" key={group.label}>
            <p className="admin-eyebrow">{group.label}</p>
            {group.links.map(link => (
              <Link key={link.href} href={link.href} className="admin-nav__link"
                aria-current={active.href === link.href ? 'page' : undefined}>
                {link.label}
              </Link>
            ))}
          </div>
        ))}
      </>
    )
  }

  return (
    <aside className="admin-sidebar">
      <div className="admin-sidebar__brand"><span className="admin-sidebar__mark" aria-hidden="true">L</span>
        <div><strong>LocReport</strong><span>Admin workspace</span></div>
      </div>
      <nav className="admin-nav admin-nav--desktop" aria-label="Admin navigation">{navigation()}</nav>
      <details className="admin-nav--mobile" key={pathname}>
        <summary><span>{active.label}</span><span className="admin-nav__toggle">All tools <span aria-hidden="true">⌄</span></span></summary>
        <nav className="admin-nav" aria-label="Admin navigation">{navigation()}</nav>
      </details>
      <Link href="/" className="admin-sidebar__site">View site <AdminArrow /></Link>
    </aside>
  )
}
