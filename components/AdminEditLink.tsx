'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

/**
 * The "Edit" affordance on a published article, resolved in the browser.
 *
 * This used to be a server-side `supabase.auth.getUser()` call on the article
 * page. That did two unhelpful things for a page whose content is identical
 * for every reader: it read cookies, which opted the page out of ISR so every
 * visitor triggered a live render, and it spent an extra Supabase round trip
 * per view to decide whether one admin sees one link.
 *
 * Checking here instead lets the article itself be cached and served without
 * touching Supabase. Readers never see this; an admin sees the link appear
 * once the session resolves.
 */
export default function AdminEditLink({ articleId }: { articleId: string }) {
  const [isAdmin, setIsAdmin] = useState(false)

  useEffect(() => {
    let active = true
    createClient()
      .auth.getUser()
      .then(({ data }) => {
        if (active) setIsAdmin(!!data.user)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])

  if (!isAdmin) return null

  return (
    <Link href={`/admin/articles/${articleId}`} className="admin-edit-btn">
      Edit
    </Link>
  )
}
