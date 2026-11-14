'use client'

import { Button } from '@/components/ui/button'

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="max-w-[760px] py-12">
      <h2 className="text-xl font-bold text-[var(--text)] mb-2">Something went wrong</h2>
      <p className="text-sm text-[var(--muted)] mb-6">
        {error.message || 'An unexpected error occurred loading this page.'}
        {error.digest && (
          <span className="block mt-1 font-mono text-xs text-[var(--muted)]">
            Digest: {error.digest}
          </span>
        )}
      </p>
      <Button onClick={reset}>
        Try again
      </Button>
    </div>
  )
}
