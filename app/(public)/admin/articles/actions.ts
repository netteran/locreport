'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { revalidateArticleSurfaces } from '@/lib/revalidate'

export async function deleteArticle(id: string) {
  const supabase = createServiceClient()
  // Grab the slug first so the article's own cached detail page goes with it.
  const { data: existing } = await supabase
    .from('articles')
    .select('slug, article_type')
    .eq('id', id)
    .maybeSingle()
  const { error } = await supabase.from('articles').delete().eq('id', id)
  if (error) throw new Error(error.message)
  revalidatePath('/admin/articles')
  revalidateArticleSurfaces({
    slug: existing?.slug,
    monthlyReport: existing?.article_type === 'monthly-summary',
  })
}
