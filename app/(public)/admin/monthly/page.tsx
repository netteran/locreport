import { AdminOperations } from '@/components/AdminOperations'
import { createServiceClient } from '@/lib/supabase/server'
import Link from 'next/link'
export const dynamic = 'force-dynamic'
export default async function MonthlyWorkspace() {
  const { data: drafts, error } = await createServiceClient().from('drafts').select('id,title,monthly_period,report_start_date,report_end_date').eq('article_type', 'monthly-summary').in('status', ['pending','rerun','rerunning']).order('created_at', { ascending: false }).limit(20)
  return <div><h1>Monthly brief</h1><p className="admin-page__subtitle">Generate a briefing, review its evidence and edit the draft before publication.</p>
    <AdminOperations area="monthly" />
    <h2 className="mt-6">Briefings awaiting review</h2>
    {error ? <p role="alert">Could not load briefing drafts: {error.message}</p> : drafts?.length ? <ul className="admin-briefing-list">{drafts.map(d => <li key={d.id}><Link href={`/admin/monthly/drafts/${d.id}`}>{d.title || d.monthly_period}</Link></li>)}</ul> : <p>No briefing drafts are awaiting review.</p>}
    <p className="mt-5"><Link href="/admin/reports">Manage published briefing and report images →</Link></p>
  </div>
}
