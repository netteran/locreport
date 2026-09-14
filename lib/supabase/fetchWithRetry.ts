/**
 * A `fetch` for public Supabase reads that fails fast and retries transient
 * gateway errors.
 *
 * Supabase sits behind Cloudflare, and that hop — not Postgres — is what
 * breaks under load: trivial queries (`select=id` against a 1.2k-row table,
 * ~1ms in the database) have been observed hanging for 30s and returning
 * 504/502/525/520. Two things follow, and this wrapper handles both:
 *
 *  - A hang outlives the page function that is waiting on it, so the render
 *    dies rather than the query. Each attempt is therefore capped well under
 *    any plausible function budget instead of inheriting fetch's open-ended
 *    default.
 *  - The failures are one-off, so a single immediate retry recovers almost
 *    all of them.
 *
 * Only idempotent methods are retried, so this stays safe if a caller ever
 * writes through it.
 */

/** Per-attempt cap. Observed p95 for these reads is ~1.2s. */
const ATTEMPT_TIMEOUT_MS = 3_500

/** Total attempts, including the first. Worst case stays ~7s. */
const MAX_ATTEMPTS = 2

const BACKOFF_MS = 150

/** Cloudflare/origin failures that mean "try again", not "this request is wrong". */
const RETRYABLE_STATUS = new Set([408, 425, 429, 502, 503, 504, 520, 521, 522, 523, 524, 525, 526])

const IDEMPOTENT = new Set(['GET', 'HEAD', 'OPTIONS'])

function methodOf(input: RequestInfo | URL, init?: RequestInit): string {
  const raw = init?.method ?? (input instanceof Request ? input.method : 'GET')
  return raw.toUpperCase()
}

/** Drop an unread error body so the connection can be reused. */
function discard(res: Response) {
  try {
    res.body?.cancel()
  } catch {}
}

export async function fetchWithRetry(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const retryable = IDEMPOTENT.has(methodOf(input, init))
  const attempts = retryable ? MAX_ATTEMPTS : 1
  let lastError: unknown

  for (let attempt = 1; attempt <= attempts; attempt++) {
    // A caller-supplied signal still wins; ours only adds an upper bound.
    const timeout = AbortSignal.timeout(ATTEMPT_TIMEOUT_MS)
    const signal = init?.signal
      ? AbortSignal.any([init.signal, timeout])
      : timeout

    try {
      const res = await fetch(input, { ...init, signal })
      if (attempt < attempts && RETRYABLE_STATUS.has(res.status)) {
        discard(res)
        lastError = new Error(`upstream ${res.status}`)
      } else {
        return res
      }
    } catch (err) {
      // Network failure or our own timeout. Both are worth one more try.
      lastError = err
      if (attempt >= attempts) break
    }

    await new Promise(r => setTimeout(r, BACKOFF_MS * attempt))
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Supabase request failed: ${String(lastError)}`)
}
