import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function requireAdmin() {
  const client = await createClient()
  const {
    data: { user }
  } = await client.auth.getUser()
  return user && process.env.ADMIN_EMAIL && user.email === process.env.ADMIN_EMAIL ? user : null
}

export function isCronRequest(req: NextRequest) {
  return (
    !!process.env.CRON_SECRET &&
    req.headers.get('Authorization') === `Bearer ${process.env.CRON_SECRET}`
  )
}

export function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}
