import { createServiceClient } from '@/lib/supabase/server'
import { FactFlowAdmin } from './FactFlowAdmin'

export const dynamic = 'force-dynamic'

export default async function AdminFactFlowPage() {
  const supabase = createServiceClient()

  const { data: facts } = await supabase
    .from('facts')
    .select('id, content, category, source_name, source_url, article_id, event_id, status, published_at, review_reason, created_at, articles(slug)')
    .order('created_at', { ascending: false })
    .limit(200)

  return <FactFlowAdmin initialFacts={facts ?? []} />
}
