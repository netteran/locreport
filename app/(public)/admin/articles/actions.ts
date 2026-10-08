'use server'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { deleteArticles as deleteArticlesWithFacts } from '@/lib/deleteArticles'

// Server actions are reachable by POST regardless of the admin layout's
// redirect, so they check the session themselves (same rule as the layout).
async function assertAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.email !== process.env.ADMIN_EMAIL) throw new Error('Unauthorized')
}

export async function deleteArticle(id: string) {
  await deleteArticles([id])
}

/** Deletes the articles and their Fact Flow facts. */
export async function deleteArticles(ids: string[]) {
  await assertAdmin()
  const result = await deleteArticlesWithFacts(createServiceClient(), ids)
  revalidatePath('/admin/articles')
  return result
}
