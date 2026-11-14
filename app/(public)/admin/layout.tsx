import { AdminNavigation } from '@/components/AdminNavigation'
import './admin.css'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user || user.email !== process.env.ADMIN_EMAIL) {
    redirect('/login')
  }

  return (
    <div className="container admin-shell">
      <a href="#admin-page" className="admin-skip-link">Skip to page content</a>
      <AdminNavigation />
      <main id="admin-content" className="admin-content">
        <div id="admin-page" className="admin-page" tabIndex={-1}>{children}</div>
      </main>
    </div>
  )
}
