import type { Metadata } from 'next'
import { fetchDirectoryEntries } from '@/lib/directory'
import { createPublicClient } from '@/lib/supabase/server'
import { DirectoryClient } from './DirectoryClient'

export const revalidate = 3600

export const metadata: Metadata = {
  title: 'Language Technology Directory | Compass',
  description: 'Comprehensive directory of language technology tools — TMS platforms, CAT tools, AI translation engines, LSPs, interpreting platforms, and more.',
  alternates: { canonical: '/compass/directory' },
}

async function getEntries() {
  const supabase = createPublicClient()
  return fetchDirectoryEntries(supabase)
}

export default async function DirectoryPage() {
  const entries = await getEntries()

  return (
    <div className="container" style={{ paddingTop: 'var(--space-8)', paddingBottom: 'var(--space-12)' }}>
      <h1 style={{ marginBottom: 'var(--space-2)' }}>Language Technology Directory</h1>
      <p style={{ color: 'var(--muted)', marginBottom: 'var(--space-6)' }}>
        {entries.length} tools &amp; companies — TMS platforms, CAT tools, AI translation engines, LSPs, interpreting platforms, and more. Click any entry for the full profile.
      </p>
      <DirectoryClient entries={entries} />
    </div>
  )
}
