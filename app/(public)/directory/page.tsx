import type { Metadata } from 'next'
import { fetchDirectoryEntries } from '@/lib/directory'
import { createPublicClient } from '@/lib/supabase/server'
import { DirectoryClient } from './DirectoryClient'

// Directory edits revalidate on demand; a day bounds the "in the news" lists.
export const revalidate = 86400

export const metadata: Metadata = {
  title: 'Language Technology Directory',
  description: 'Comprehensive directory of language technology tools — TMS platforms, CAT tools, AI translation engines, LSPs, interpreting platforms, and more.',
  alternates: { canonical: '/directory' },
}

async function getEntries() {
  const supabase = createPublicClient()
  return fetchDirectoryEntries(supabase)
}

export default async function DirectoryPage() {
  const entries = await getEntries()

  return (
    <main className="container public-page">
      <header className="public-page-heading">
        <h1>Language Technology Directory</h1>
        <p>
          {entries.length} tools &amp; companies — TMS platforms, CAT tools, AI translation engines, LSPs, interpreting platforms, and more. Click any entry for the full profile.
        </p>
      </header>
      <DirectoryClient entries={entries} />
    </main>
  )
}
