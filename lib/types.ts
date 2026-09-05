export interface RssSource {
  id: string
  url: string
  name: string
  active: boolean
  keywords: string[]
  created_at: string
}

export interface Draft {
  id: string
  title: string
  slug: string
  content: string
  source_url: string | null
  source_feed_id: string | null
  source_published_at: string | null
  image_url: string | null
  image_alt: string | null
  status: 'pending' | 'approved' | 'rejected' | 'rerunning' | 'rerun'
  created_at: string
  updated_at: string
}

export interface Article {
  id: string
  title: string
  slug: string
  excerpt: string | null
  content: string
  article_type: 'industry' | 'monthly-summary'
  author: string | null
  publisher: string | null
  source_url: string | null
  // Optional lead image — hero on the article page, thumbnail in listings.
  image_url: string | null
  image_alt: string | null
  signal_ids: string[]
  signal_stance: string | null
  signal_confidence: string | null
  impact_score: number | null
  time_horizon: string | null
  affected_segments: string[]
  business_implications: string[]
  tags: string[]
  published_at: string
  updated_at: string
  draft_id: string | null
  // pgvector column; PostgREST returns it serialized as a string
  embedding?: string | null
}
