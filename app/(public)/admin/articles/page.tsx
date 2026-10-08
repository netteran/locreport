import { createServiceClient } from '@/lib/supabase/server'
import { ArticleList } from './ArticleList'

export const dynamic = 'force-dynamic'

export default async function AdminArticlesPage() {
  const supabase = createServiceClient()
  const { data: articles } = await supabase
    .from('articles')
    .select('id, title, slug, published_at, article_type, publisher')
    .order('published_at', { ascending: false })

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6" style={{ color: 'var(--text)' }}>Published Articles</h1>
      <div className="max-w-[760px]">
        <ArticleList articles={articles ?? []} />
      </div>
    </div>
  )
}
