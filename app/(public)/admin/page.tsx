import Link from 'next/link'
import { ADMIN_LINKS } from '@/lib/adminNav'
import { AdminOperations } from '@/components/AdminOperations'
import { AdminArrow } from '@/components/AdminArrow'
export default function AdminDashboard() {
  return <div className="admin-dashboard">
    <header className="admin-dashboard__header"><div><h1>Dashboard</h1>
      <p className="admin-page__subtitle">Daily collection and data updates.</p></div></header>
    <section aria-labelledby="daily-title"><h2 id="daily-title">Daily operations</h2><AdminOperations area="daily" /></section>
    <nav className="admin-area-grid" aria-label="Editorial areas">
      {ADMIN_LINKS.slice(1).map(link => <Link key={link.href} href={link.href} className="admin-area-card">
        <strong>{link.label}<AdminArrow /></strong><span>{link.description}</span>
      </Link>)}
    </nav>
  </div>
}
