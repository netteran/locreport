import { createServerClient } from '@supabase/ssr'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { fetchWithRetry } from './fetchWithRetry'

export async function createClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {}
        },
      },
    }
  )
}

export function createServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

/**
 * Cookie-free read client for public pages.
 *
 * `createClient()` above reads `cookies()`, which is a Next.js Dynamic API:
 * touching it opts the calling page out of static rendering, so its
 * `export const revalidate` never takes effect and every visitor pays a live
 * round trip to Supabase. Public pages read public data as `anon` and have no
 * session to carry, so they use this client instead and stay cacheable — a
 * Supabase blip then costs a background revalidation, not a blank page.
 *
 * Anything that reads the signed-in user (admin surfaces) must keep using
 * `createClient()`.
 */
export function createPublicClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: fetchWithRetry },
    }
  )
}
