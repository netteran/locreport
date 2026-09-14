'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'

// The site's only digest signup. It surfaces itself once per visitor — after
// they've shown some engagement — and can be reopened from the footer link
// (components/DigestPopupTrigger.tsx) at any time.
export const OPEN_DIGEST_EVENT = 'locreport:digest-open'

const STORE_KEY = 'locreport.digest'
const VIEWS_KEY = 'locreport.digest.views'

/** Auto-open once the visitor has been on the site this long… */
const DELAY_MS = 45_000
/** …or has scrolled this far down a page, whichever lands first. */
const SCROLL_FRACTION = 0.5
/**
 * Page views in this session before the popup may auto-open. At 2 the popup
 * never interrupts a landing page — the trade-off is that a single-page visit
 * (search → article → leave) never sees it. Drop to 1 to reach those visitors,
 * in which case DELAY_MS/SCROLL_FRACTION alone gate it.
 */
const MIN_PAGE_VIEWS = 2
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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function DigestPopup() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [message, setMessage] = useState('')

  const dialogRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  // Auto-open fires at most once per page load, whichever trigger wins.
  const armedRef = useRef(false)

  const close = useCallback(() => {
    setOpen(false)
    // Only a dismissal needs recording; a successful signup already stored
    // 'subscribed', and overwriting it would re-arm the popup in 60 days.
    if (readStore()?.status !== 'subscribed') writeStore('dismissed')
  }, [])

  const show = useCallback(() => {
    if (armedRef.current) return
    armedRef.current = true
    restoreFocusRef.current = document.activeElement as HTMLElement | null
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
    if (views < MIN_PAGE_VIEWS) return

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

  // While open: lock the background, trap Tab inside the dialog, close on Esc.
  useEffect(() => {
    if (!open) return

    const { overflow } = document.body.style
    document.body.style.overflow = 'hidden'
    inputRef.current?.focus()

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
      document.body.style.overflow = overflow
      restoreFocusRef.current?.focus?.()
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
    } catch {
      setMessage('Something went wrong — please try again.')
      setStatus('error')
    }
  }

  if (!open) return null

  return (
    <div
      className="digest-popup__overlay"
      onMouseDown={e => { if (e.target === e.currentTarget) close() }}
    >
      <div
        className="digest-popup"
        role="dialog"
        aria-modal="true"
        aria-labelledby="digest-popup-title"
        ref={dialogRef}
      >
        <button type="button" className="digest-popup__close" onClick={close} aria-label="Close">
          ×
        </button>

        {status === 'sent' ? (
          <>
            <p className="digest-popup__eyebrow">Almost there</p>
            <h2 className="digest-popup__title" id="digest-popup-title">Check your inbox</h2>
            <p className="digest-popup__text" role="status">{message}</p>
            <button type="button" className="btn btn--primary digest-popup__btn" onClick={close}>
              Done
            </button>
          </>
        ) : (
          <>
            <p className="digest-popup__eyebrow">Weekly digest</p>
            <h2 className="digest-popup__title" id="digest-popup-title">The industry, digested</h2>
            <p className="digest-popup__text">
              One email a week: impact-ranked stories mapped to the signals
              shaping language services. No noise.
            </p>
            <form className="digest-popup__form" onSubmit={submit} noValidate>
              <input
                ref={inputRef}
                type="email"
                className="digest-popup__input"
                placeholder="you@company.com"
                aria-label="Email address"
                autoComplete="email"
                value={email}
                onChange={e => { setEmail(e.target.value); setStatus('idle') }}
              />
              <button
                type="submit"
                className="btn btn--primary digest-popup__btn"
                disabled={status === 'sending'}
              >
                {status === 'sending' ? 'Subscribing…' : 'Get the digest'}
              </button>
            </form>
            {status === 'error' && (
              <p className="digest-popup__error" role="alert">{message}</p>
            )}
            <p className="digest-popup__note">
              Free. Unsubscribe anytime. We never share your address.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
