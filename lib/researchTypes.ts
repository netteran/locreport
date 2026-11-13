export interface SourceCandidate {
  id: string
  title: string
  source_url: string
  source_name: string | null
  source_feed_id: string | null
  source_published_at: string | null
  extracted_facts: string
  quality: 'full' | 'snippet' | 'notes'
  topics: string[]
  entities: string[]
  status: 'available' | 'reserved' | 'used' | 'dismissed'
  processing_status: 'pending' | 'ready' | 'error'
  review_reason: string | null
  event_id: string | null
  suggested_event_id: string | null
  suggested_fact_id?: string | null
  reserved_by: string | null
  created_at: string
}

export interface EventDescriptor {
  subject: string
  action: string
  object: string
  stage: string
  event_date: string | null
  headline: string | null
  newsworthy: boolean
  entities: string[]
  topics: string[]
}

export interface StoryGroup {
  id: string
  title: string
  question: string
  rationale: string
  candidate_ids: string[]
  dismissed: boolean
}

export interface Composition {
  id: string
  title: string
  angle: string
  personal_experience: string
  target_words: number
  status: 'editing' | 'generating' | 'ready' | 'published' | 'abandoned' | 'failed'
  draft_id: string | null
  last_error: string | null
  generation_request_id?: string | null
  composition_sources?: {
    candidate_id: string
    snapshot: SourceCandidate
    covered: boolean
    position: number
  }[]
}
