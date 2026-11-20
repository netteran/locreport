'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'

export function AdminEditButton({ slug }: { slug: string }) {
  const [isAdmin, setIsAdmin] = useState(false)

  useEffect(() => {
    fetch('/api/me')
      .then(r => r.json())
      .then(d => { if (d.isAdmin) setIsAdmin(true) })
      .catch(() => {})
  }, [])

  if (!isAdmin) return null

  return (
    <Link
      href={`/admin/directory?edit=${slug}`}
      className="dir-admin-edit-btn"
      title="Edit this entry"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
        <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
      </svg>
      Edit entry
    </Link>
  )
}
