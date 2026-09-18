'use client'
import Link from 'next/link'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useEffect, useState, useRef } from 'react'
import { ReadingProgress } from '@/components/ReadingProgress'
import { ADMIN_LINKS } from '@/lib/adminNav'

const NAV_LINKS = [
  { href: '/articles', label: 'All articles' },
  { href: '/fact-flow', label: 'Fact Flow', live: true },
  {
    href: '/intelligence', label: 'Intelligence', dropdown: [
      { href: '/intelligence/signals', label: 'Signals tracker' },
      { href: '/intelligence/high-impact', label: 'High impact articles' },
    ]
  },
  {
    href: '/reports', label: 'Reports', dropdown: [
      { href: '/reports/2026-annual-global-market-report', label: '2026 Annual Report' },
      { href: '/reports/monthly', label: 'Monthly reports' },
    ]
  },
  {
    href: '/compass', label: 'Compass', dropdown: [
      { href: '/compass/locstock', label: 'LocStock' },
      { href: '/compass/llm-pricing', label: 'AI Cost Simulator' },
      { href: '/compass/directory', label: 'Tech Directory' },
    ]
  },
]

// Sentinel key for openDropdown — keeps the Admin menu on the exact same
// hover-intent open/close state machine as the main nav dropdowns below.
const ADMIN_MENU_KEY = '__admin-menu__'

export function Nav() {
  const router = useRouter()
  const [isAdmin, setIsAdmin] = useState(false)
  const [email, setEmail] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [openDropdown, setOpenDropdown] = useState<string | null>(null)
  // Whether the primary input can hover (mouse/trackpad) vs. touch-only.
  // Drives the Admin menu: hover-intent open/close on desktop, tap-to-toggle
  // on touch — checked by input capability, not viewport width, so it holds
  // up on touch tablets/hybrids too.
  const [canHover, setCanHover] = useState(() => {
    if (typeof window === 'undefined') return true
    return window.matchMedia('(hover: hover)').matches
  })
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof document === 'undefined') return 'light'
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'
  })
  const searchRef = useRef<HTMLInputElement>(null)
  const navRef = useRef<HTMLElement>(null)
  const adminMenuRef = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function openMenu(href: string) {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    setOpenDropdown(href)
  }

  function scheduleClose() {
    closeTimer.current = setTimeout(() => setOpenDropdown(null), 150)
  }

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const target = e.target as Node
      const insideNav = navRef.current?.contains(target)
      const insideAdminMenu = adminMenuRef.current?.contains(target)
      if (!insideNav && !insideAdminMenu) {
        setOpenDropdown(null)
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  useEffect(() => {
    const mql = window.matchMedia('(hover: hover)')
    const handleChange = () => setCanHover(mql.matches)
    mql.addEventListener('change', handleChange)
    return () => mql.removeEventListener('change', handleChange)
  }, [])

  useEffect(() => {
    // Theme is stamped on <html> before paint by the inline script in app/layout.tsx;
    // sync state in case hydration raced it.
    const current = document.documentElement.getAttribute('data-theme')
    if (current === 'dark' || current === 'light') setTheme(current)
    fetch('/api/me').then(r => r.json()).then(({ email, isAdmin }) => {
      setEmail(email)
      setIsAdmin(isAdmin)
    })
  }, [])

  function toggleTheme() {
    const next = theme === 'light' ? 'dark' : 'light'
    setTheme(next)
    document.documentElement.setAttribute('data-theme', next)
    localStorage.setItem('theme', next)
  }

  function toggleSearch() {
    setSearchOpen(v => !v)
    if (!searchOpen) setTimeout(() => searchRef.current?.focus(), 50)
  }

  async function signOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    setEmail(null)
    setIsAdmin(false)
    router.push('/')
    router.refresh()
  }

  const allLinks = NAV_LINKS

  return (
    <header className="site-header">
      <div className="header-shell">
        <Link href="/" className="site-logo" aria-label="LocReport home">
          <Image src="/logolight.png" alt="LocReport" width={120} height={32} className="site-logo-img site-logo-img--light" priority />
          <Image src="/logodark.png" alt="LocReport" width={120} height={32} className="site-logo-img site-logo-img--dark" priority />
        </Link>

        <nav ref={navRef} className={`site-nav${menuOpen ? ' is-open' : ''}`}>
          <button
            className="nav-toggle"
            id="nav-toggle"
            aria-label="Toggle menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(v => !v)}
          >
            <span className="hamburger-bar" />
            <span className="hamburger-bar" />
            <span className="hamburger-bar" />
          </button>

          <ul id="site-menu">
            {allLinks.map(link => (
              'dropdown' in link && link.dropdown ? (
                <li key={link.href} className="nav-has-dropdown"
                  onMouseEnter={() => openMenu(link.href)}
                  onMouseLeave={scheduleClose}
                >
                  <div className="nav-dropdown-trigger">
                    <Link href={link.href} onClick={() => setMenuOpen(false)}>{link.label}</Link>
                    <button aria-haspopup="true" aria-expanded={openDropdown === link.href} aria-label={`Toggle ${link.label} menu`}>
                      <svg className="nav-dropdown-chevron" xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                        <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </button>
                  </div>
                  <ul className={`nav-dropdown-menu${openDropdown === link.href ? ' is-open' : ''}`} role="menu"
                    onMouseEnter={() => openMenu(link.href)}
                    onMouseLeave={scheduleClose}
                  >
                    {link.dropdown.map(child => (
                      <li key={child.href} role="none">
                        <Link href={child.href} role="menuitem" onClick={() => { setOpenDropdown(null); setMenuOpen(false) }}>{child.label}</Link>
                      </li>
                    ))}
                  </ul>
                </li>
              ) : (
                <li key={link.href}>
                  <Link href={link.href} onClick={() => setMenuOpen(false)}>
                    {link.label}
                    {'live' in link && link.live && (
                      <span className="nav-live-badge" title="Updated in real-time">
                        <span className="nav-live-badge__dot" aria-hidden="true" />
                        Live
                      </span>
                    )}
                  </Link>
                </li>
              )
            ))}
          </ul>
        </nav>

        <div className={`nav-actions${searchOpen ? ' search-expanded' : ''}`}>
          {/* Inline search */}
          <div className={`search-inline${searchOpen ? ' is-expanded' : ''}`} id="search-inline">
            <button className="search-toggle" id="search-toggle" aria-label="Open search" aria-expanded={searchOpen} onClick={toggleSearch}>
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
            </button>
            <div className="search-inline-field" id="search-inline-field">
              <svg className="search-inline-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <input
                ref={searchRef}
                type="text"
                className="search-inline-input"
                placeholder="Search LocReport…"
                autoComplete="off"
                aria-label="Search LocReport"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && searchQuery) {
                    router.push(`/search?q=${encodeURIComponent(searchQuery)}`)
                    setSearchOpen(false)
                    setSearchQuery('')
                  }
                }}
              />
              <button className="search-inline-close" aria-label="Close search" onClick={() => { setSearchOpen(false); setSearchQuery('') }}>
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
          </div>

          {/* Theme toggle */}
          <button className="theme-toggle" id="theme-toggle" aria-label="Toggle theme" onClick={toggleTheme}>
            <svg className="theme-icon theme-icon--dark" id="icon-moon" xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
            </svg>
            <svg className="theme-icon theme-icon--light" id="icon-sun" xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="5"/>
              <line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
              <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
            </svg>
          </button>

          {email ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              {isAdmin && (
                <div
                  ref={adminMenuRef}
                  className="nav-has-dropdown admin-menu"
                  onMouseEnter={canHover ? () => openMenu(ADMIN_MENU_KEY) : undefined}
                  onMouseLeave={canHover ? scheduleClose : undefined}
                >
                  <button
                    onClick={() => setOpenDropdown(v => v === ADMIN_MENU_KEY ? null : ADMIN_MENU_KEY)}
                    aria-haspopup="true"
                    aria-expanded={openDropdown === ADMIN_MENU_KEY}
                    aria-label="Toggle admin menu"
                  >
                    Admin
                    <svg
                      className="nav-dropdown-chevron"
                      width="10"
                      height="10"
                      viewBox="0 0 12 12"
                      fill="none"
                      aria-hidden="true"
                    >
                      <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </button>
                  <ul
                    className={`admin-menu-dropdown${openDropdown === ADMIN_MENU_KEY ? ' is-open' : ''}`}
                    role="menu"
                    onMouseEnter={canHover ? () => openMenu(ADMIN_MENU_KEY) : undefined}
                    onMouseLeave={canHover ? scheduleClose : undefined}
                  >
                    {ADMIN_LINKS.map(({ href, label }) => (
                      <li key={href} role="none">
                        <Link href={href} role="menuitem" onClick={() => setOpenDropdown(null)}>{label}</Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <button
                onClick={signOut}
                style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer', padding: '6px 10px' }}
              >
                Sign out
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {isAdmin && (
        <nav className="admin-subnav" aria-label="Admin">
          <div className="admin-subnav-inner">
            <span className="admin-subnav-label">Admin</span>
            {ADMIN_LINKS.map(({ href, label }) => (
              <Link key={href} href={href}>{label}</Link>
            ))}
          </div>
        </nav>
      )}

      <ReadingProgress />
    </header>
  )
}
