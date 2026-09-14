export interface RssSource {
  id: string
  url: string
  name: string
  active: boolean
  keywords: string[]
  created_at: string
}

export interface ContentFilter {
  keywords: string[]
  minMatches?: number
  checkFullContent?: boolean
  maxScan?: number
}

// A scrape target for the feed generator (lib/feedGenerator.ts) — an HTML
// listing page (CSS selectors) or an existing feed re-filtered by keyword.
// Served publicly at /api/feeds/[name]; an rss_sources row can point at that
// URL like any other feed. Replaces the standalone rss-generator repo.
export interface ScrapedSource {
  id: string
  name: string
  type: 'html' | 'rss'
  url: string
  active: boolean
  article_selector: string | null
  title_selector: string | null
  link_selector: string | null
  description_selector: string | null
  date_selector: string | null
  link_pattern: string | null
  feed_title: string | null
  feed_description: string | null
  content_filter: ContentFilter | null
  classified_links: Record<string, { relevant: boolean; checkedAt: string }>
  generated_xml: string | null
  last_run_at: string | null
  last_status: 'success' | 'error' | null
  last_error: string | null
  last_item_count: number | null
  created_at: string
  updated_at: string
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
  // Raw Stage 1 fact sheet the draft was written from. Re-runs reuse it verbatim so only
  // the Stage 2 prose is regenerated. Null on pre-existing or hand-made drafts.
  extracted_facts: string | null
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
