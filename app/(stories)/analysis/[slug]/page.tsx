import { PublicArticle, articleMetadata } from '@/components/PublicArticle'
import '../../reading.css'

export const revalidate = 86400
export const dynamic = 'force-static'

export function generateStaticParams() {
  return []
}

type Props = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Props) {
  return articleMetadata((await params).slug, 'analysis')
}

export default async function ArticlePage({ params }: Props) {
  return <PublicArticle slug={(await params).slug} contentType="analysis" />
}
