'use client'

import { OPEN_DIGEST_EVENT } from '@/components/DigestPopup'

// The permanent way back into the digest popup, for anyone who dismissed it
// or already used up their one automatic showing. Communicates by window
// event so the footer (a Server Component) needs no shared provider.
export function DigestPopupTrigger({ className, children }: {
  className?: string
  children?: React.ReactNode
}) {
  return (
    <button
      type="button"
      className={className}
      onClick={() => window.dispatchEvent(new Event(OPEN_DIGEST_EVENT))}
    >
      {children ?? 'Get the digest'}
    </button>
  )
}
