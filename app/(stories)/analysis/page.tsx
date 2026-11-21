import type { Metadata } from 'next'
import { ContentArchive } from '@/components/ContentArchive'
import { CONTENT_TAXONOMY } from '@/lib/contentTaxonomy'

export const revalidate = 3600

const taxonomy = CONTENT_TAXONOMY.analysis
export const metadata: Metadata = {
  title: taxonomy.section,
  description: taxonomy.description,
  alternates: { canonical: taxonomy.path },
}

export default function ArchivePage() {
  return <ContentArchive contentType="analysis" />
}
