import type { Metadata } from 'next'
import { ContentArchive } from '@/components/ContentArchive'
import { CONTENT_TAXONOMY } from '@/lib/contentTaxonomy'

// Publishes revalidate this on demand; the window is only a safety net.
export const revalidate = 21600

const taxonomy = CONTENT_TAXONOMY.brief
export const metadata: Metadata = {
  title: taxonomy.section,
  description: taxonomy.description,
  alternates: { canonical: taxonomy.path },
}

export default function ArchivePage() {
  return <ContentArchive contentType="brief" />
}
