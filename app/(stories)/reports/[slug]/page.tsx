import { PublicArticle, articleMetadata } from '@/components/PublicArticle'
import '../../reading.css'

// A week: edits, deletes and noindex changes revalidate the page on demand
// (lib/revalidate.ts), so the window only refreshes the related-reading rail.
// Every regeneration is an ISR write — see "ISR write budget" in CLAUDE.md.
export const revalidate = 604800
export const dynamic = 'force-static'

export function generateStaticParams() {
  return []
}

type Props = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Props) {
  return articleMetadata((await params).slug, 'report')
}

export default async function ArticlePage({ params }: Props) {
  return <PublicArticle slug={(await params).slug} contentType="report" />
}
