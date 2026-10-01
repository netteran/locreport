'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { usePathname } from 'next/navigation'

// The site's only digest signup. It surfaces itself once per visitor — after
// they've shown some engagement — and can be reopened at any time from the
// footer link (components/DigestPopupTrigger.tsx) or from the launcher it
// keeps docked in the bottom-left corner. Closing the dialog visibly shrinks
// it into that launcher, so the visitor sees where it went.
export const OPEN_DIGEST_EVENT = 'locreport:digest-open'

const STORE_KEY = 'locreport.digest'
const VIEWS_KEY = 'locreport.digest.views'

/** Auto-open once the visitor has been on the site this long… */
const DELAY_MS = 45_000
/** …or has scrolled this far down a page, whichever lands first. */
const SCROLL_FRACTION = 0.5
/**
 * Page views in this session before the popup may auto-open. At 1 it can fire
 * on the landing page, so the single-page visit (search → article → leave) —
 * a large share of traffic — is reached, and DELAY_MS/SCROLL_FRACTION are the
 * real gate. Raise to 2 to require a second page view on top of those.
 */
const MIN_PAGE_VIEWS = 1
/** How long a dismissal suppresses the auto-open. Subscribing suppresses it for good. */
const DISMISS_DAYS = 60

type Stored = { status: 'dismissed' | 'subscribed'; at: number }

// Every storage access is guarded: private windows, blocked site data and
// some embedded browsers throw on read or write, and none of that should
// stop the page rendering.
function readStore(): Stored | null {
  try {
    const raw = window.localStorage.getItem(STORE_KEY)
    return raw ? (JSON.parse(raw) as Stored) : null
  } catch {
    return null
  }
}

function writeStore(status: Stored['status']) {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify({ status, at: Date.now() }))
  } catch {
    /* nothing to do — the popup just reappears next session */
  }
}

function suppressed(): boolean {
  const stored = readStore()
  if (!stored) return false
  if (stored.status === 'subscribed') return true
  return Date.now() - stored.at < DISMISS_DAYS * 24 * 60 * 60 * 1000
}

function bumpPageViews(): number {
  try {
    const next = (parseInt(window.sessionStorage.getItem(VIEWS_KEY) ?? '0', 10) || 0) + 1
    window.sessionStorage.setItem(VIEWS_KEY, String(next))
    return next
  } catch {
    return 0
  }
}

/** Length of the shrink-into-the-corner animation; keep in step with style.css. */
const MINIMIZE_MS = 380
/** How long the launcher shows its label after the dialog lands in it. */
const PEEK_MS = 4000
/** Pages where the launcher would be noise: the admin desk and its sign-in. */
const NO_LAUNCHER = /^\/(admin|login)(\/|$)/

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function DigestPopup() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [message, setMessage] = useState('')
  const [minimizing, setMinimizing] = useState(false)
  // The launcher is client-only: whether to show it depends on localStorage.
  const [mounted, setMounted] = useState(false)
  const [subscribed, setSubscribed] = useState(false)
  const [peek, setPeek] = useState(false)

  const dialogRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  const launcherRef = useRef<HTMLButtonElement>(null)
  const minimizingRef = useRef(false)
  // Auto-open fires at most once per page load, whichever trigger wins.
  const armedRef = useRef(false)

  const close = useCallback(() => {
    if (minimizingRef.current) return
    // Only a dismissal needs recording; a successful signup already stored
    // 'subscribed', and overwriting it would re-arm the popup in 60 days.
    if (readStore()?.status !== 'subscribed') writeStore('dismissed')

    const launcher = launcherRef.current
    const dialog = dialogRef.current
    if (!launcher || !dialog || prefersReducedMotion()) {
      setOpen(false)
      return
    }

    // Shrink the dialog into the launcher: aim its centre at the launcher's.
    const from = dialog.getBoundingClientRect()
    const to = launcher.getBoundingClientRect()
    dialog.style.setProperty('--digest-dx', `${to.left + to.width / 2 - (from.left + from.width / 2)}px`)
    dialog.style.setProperty('--digest-dy', `${to.top + to.height / 2 - (from.top + from.height / 2)}px`)
    minimizingRef.current = true
    setMinimizing(true)
    window.setTimeout(() => {
      minimizingRef.current = false
      setMinimizing(false)
      setOpen(false)
      setPeek(true)
    }, MINIMIZE_MS)
  }, [])

  useEffect(() => {
    setMounted(true)
    setSubscribed(readStore()?.status === 'subscribed')
  }, [])

  // After landing, the launcher spells out what it is for a few seconds.
  useEffect(() => {
    if (!peek) return
    const t = window.setTimeout(() => setPeek(false), PEEK_MS)
    return () => window.clearTimeout(t)
  }, [peek])

  const show = useCallback(() => {
    if (armedRef.current) return
    armedRef.current = true
    restoreFocusRef.current = document.activeElement as HTMLElement | null
    setPeek(false)
    setOpen(true)
  }, [])

  // Reopening from the footer link bypasses every suppression rule — the
  // visitor asked for it.
  useEffect(() => {
    function onRequest() {
      armedRef.current = false
      show()
    }
    window.addEventListener(OPEN_DIGEST_EVENT, onRequest)
    return () => window.removeEventListener(OPEN_DIGEST_EVENT, onRequest)
  }, [show])

  // Count this page view. Client-side navigations don't remount the layout,
  // so the pathname change is what marks a new view.
  useEffect(() => {
    bumpPageViews()
  }, [pathname])

  // Arm the auto-open: a timer and a scroll-depth watcher, first one wins.
  useEffect(() => {
    if (suppressed()) return

    let views = 0
    try {
      views = parseInt(window.sessionStorage.getItem(VIEWS_KEY) ?? '0', 10) || 0
    } catch {
      return // no sessionStorage means no view count to gate on — stay quiet
    }
    if (views < MIN_PAGE_VIEWS) return // the effect above already counted this view

    const timer = window.setTimeout(show, DELAY_MS)

    function onScroll() {
      const scrollable = document.documentElement.scrollHeight - window.innerHeight
      if (scrollable <= 0) return // page doesn't scroll; leave it to the timer
      if (window.scrollY / scrollable >= SCROLL_FRACTION) show()
    }
    window.addEventListener('scroll', onScroll, { passive: true })

    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('scroll', onScroll)
    }
  }, [pathname, show])

  // While open the page behind is frozen: nothing scrolls, nothing behind
  // the overlay can be focused or clicked, and only the dialog's own controls
  // work. Tab is trapped inside it and Esc closes it.
  useEffect(() => {
    if (!open) return

    // Freeze the page in place. overflow:hidden alone doesn't stop iOS Safari
    // scrolling the body, so pin it with position:fixed at its current offset
    // and put it back exactly there on close.
    const body = document.body
    const html = document.documentElement
    const scrollY = window.scrollY
    const saved = {
      position: body.style.position, top: body.style.top, left: body.style.left,
      right: body.style.right, width: body.style.width, overflow: body.style.overflow,
      paddingRight: body.style.paddingRight, overscroll: html.style.overscrollBehavior,
    }
    const scrollbar = window.innerWidth - html.clientWidth // avoid a desktop layout jump
    body.style.position = 'fixed'
    body.style.top = `-${scrollY}px`
    body.style.left = '0'
    body.style.right = '0'
    body.style.width = '100%'
    body.style.overflow = 'hidden'
    if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`
    html.style.overscrollBehavior = 'none'

    // Everything else on the page becomes inert: unfocusable, unclickable,
    // hidden from screen readers. The overlay is portalled straight into
    // <body>, so it is the one child left alone.
    const inerted: Element[] = []
    for (const el of Array.from(body.children)) {
      if (el === overlayRef.current || el.hasAttribute('inert')) continue
      if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'LINK') continue
      el.setAttribute('inert', '')
      inerted.push(el)
    }

    // Focus the dialog itself, never the email field: focusing the input
    // would pop the on-screen keyboard on phones and shove the layout around.
    // The keyboard appears only when the visitor taps the field.
    dialogRef.current?.focus({ preventScroll: true })

    // When the keyboard does open, keep the overlay sized to the part of the
    // screen that is still visible, so the dialog stays centred above it.
    const vv = window.visualViewport
    function fitViewport() {
      const overlay = overlayRef.current
      if (!overlay || !vv) return
      overlay.style.top = `${vv.offsetTop}px`
      overlay.style.height = `${vv.height}px`
    }
    fitViewport()
    vv?.addEventListener('resize', fitViewport)
    vv?.addEventListener('scroll', fitViewport)

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        close()
        return
      }
      if (e.key !== 'Tab' || !dialogRef.current) return
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      vv?.removeEventListener('resize', fitViewport)
      vv?.removeEventListener('scroll', fitViewport)
      for (const el of inerted) el.removeAttribute('inert')
      body.style.position = saved.position
      body.style.top = saved.top
      body.style.left = saved.left
      body.style.right = saved.right
      body.style.width = saved.width
      body.style.overflow = saved.overflow
      body.style.paddingRight = saved.paddingRight
      html.style.overscrollBehavior = saved.overscroll
      window.scrollTo({ top: scrollY, behavior: 'instant' })
      // An auto-open had nothing focused; hand focus to the launcher the
      // dialog just went into rather than dropping it on <body>.
      const back = restoreFocusRef.current
      if (back && back !== document.body && back.isConnected) back.focus?.()
      else launcherRef.current?.focus({ preventScroll: true })
    }
  }, [open, close])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const value = email.trim()
    if (status === 'sending') return
    if (!EMAIL_RE.test(value)) {
      setMessage('Please enter a valid email address.')
      setStatus('error')
      return
    }
    setStatus('sending')
    try {
      const res = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: value }),
      })
      const data = await res.json()
      if (!res.ok) {
        setMessage(data.error ?? 'Something went wrong — please try again.')
        setStatus('error')
        return
      }
      setMessage(data.message ?? 'Check your inbox to confirm your subscription.')
      setStatus('sent')
      setEmail('')
      writeStore('subscribed')
      setSubscribed(true)
    } catch {
      setMessage('Something went wrong — please try again.')
      setStatus('error')
    }
  }

  const dialogEl = open && (
    // No click-outside-to-close: a stray tap beside the card (easy on a
    // phone, especially while the keyboard is sliding away) must not throw
    // away what was typed. × , Esc and Done are the ways out.
    <div
      ref={overlayRef}
      className={`digest-popup__overlay${minimizing ? ' is-minimizing' : ''}`}
    >
      <div
        className={`digest-popup${minimizing ? ' is-minimizing' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="digest-popup-title"
        ref={dialogRef}
        tabIndex={-1}
      >
        <button type="button" className="digest-popup__close" onClick={close} aria-label="Close">
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M1.5 1.5l9 9m0-9l-9 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>

        {status === 'sent' && (
          <div className="digest-popup__icon" aria-hidden="true">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
              <path d="M5 12.5l4.2 4.2L19 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        )}

        {status === 'sent' ? (
          <>
            <h2 className="digest-popup__title" id="digest-popup-title">Check your inbox</h2>
            <p className="digest-popup__text" role="status">{message}</p>
            <button type="button" className="digest-popup__btn" onClick={close}>
              Done
            </button>
          </>
        ) : (
          <>
            <p className="digest-popup__eyebrow">The Weekly</p>
            <h2 className="digest-popup__title" id="digest-popup-title">
              Curious about where translation &amp; AI are heading?
            </h2>
            <p className="digest-popup__text">
              We send a quick 5-minute roundup of the week’s best stories every
              Friday. Clean, useful, and zero spam.
            </p>
            <form className="digest-popup__form" onSubmit={submit} noValidate>
              <input
                type="email"
                className="digest-popup__input"
                placeholder="your.email@address.com"
                aria-label="Email address"
                autoComplete="email"
                value={email}
                onChange={e => { setEmail(e.target.value); setStatus('idle') }}
              />
              <button
                type="submit"
                className="digest-popup__btn"
                disabled={status === 'sending'}
              >
                {status === 'sending' ? 'Signing up…' : 'Sign up'}
              </button>
            </form>
            {status === 'error' && (
              <p className="digest-popup__error" role="alert">{message}</p>
            )}
            <p className="digest-popup__note">
              Free <span aria-hidden="true">•</span> Unsubscribe anytime
            </p>
          </>
        )}
      </div>
    </div>
  )

  const showLauncher = mounted && !subscribed && !NO_LAUNCHER.test(pathname ?? '')

  return (
    <>
      {showLauncher && (
        <button
          ref={launcherRef}
          type="button"
          className={`digest-launcher${peek ? ' is-peeking' : ''}`}
          onClick={() => { armedRef.current = false; show() }}
          aria-haspopup="dialog"
          aria-expanded={open}
        >
          <span className="digest-launcher__icon" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <rect x="3" y="5.5" width="18" height="13" rx="3" stroke="currentColor" strokeWidth="1.8" />
              <path d="M4 7.5l8 5.5 8-5.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="digest-launcher__label">
            Get <strong>The Weekly</strong>
          </span>
        </button>
      )}
      {dialogEl && createPortal(dialogEl, document.body)}
    </>
  )
}
