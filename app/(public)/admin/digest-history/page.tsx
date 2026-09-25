import { createServiceClient } from '@/lib/supabase/server'
import { formatPeriodRange } from '@/lib/email/period'

export const dynamic = 'force-dynamic'

const HISTORY_LIMIT = 500

interface DigestSendRow {
  id: string
  period_start: string
  period_end: string
  sent_at: string
  subject: string | null
  article_ids: string[] | null
  subscribers: { email: string } | { email: string }[] | null
}

function subscriberEmail(row: DigestSendRow): string {
  const s = row.subscribers
  if (Array.isArray(s)) return s[0]?.email ?? '—'
  return s?.email ?? '—'
}


export default async function DigestHistoryPage() {
  const supabase = createServiceClient()
  const { data: sends, error } = await supabase
    .from('digest_sends')
    .select('id, period_start, period_end, sent_at, subject, article_ids, subscribers(email)')
    .order('sent_at', { ascending: false })
    .limit(HISTORY_LIMIT)

  if (error) throw new Error(error.message)

  const rows = (sends ?? []) as unknown as DigestSendRow[]
  const groups = new Map<string, DigestSendRow[]>()
  for (const row of rows) {
    const list = groups.get(row.period_start)
    if (list) list.push(row)
    else groups.set(row.period_start, [row])
  }
  const periods = [...groups.entries()].sort((a, b) => b[0].localeCompare(a[0]))

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2" style={{ color: 'var(--text)' }}>The Weekly — sent issues</h1>
      <p className="text-sm mb-6 max-w-[760px]" style={{ color: 'var(--muted)' }}>
        Every copy actually sent, grouped by issue and newest first. Since 25 September 2026 every subscriber
        gets the same issue; earlier issues were personalised, so their rows can differ. Sends from before this
        page existed have no stored copy — those show without a View link.
        {rows.length === HISTORY_LIMIT && ` Showing the most recent ${HISTORY_LIMIT}.`}
      </p>

      {periods.length === 0 && <p style={{ color: 'var(--muted)' }}>Nothing sent yet.</p>}

      <div className="flex flex-col gap-6">
        {periods.map(([periodStart, periodRows]) => (
          <div key={periodStart} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
            <div
              className="flex items-center justify-between gap-4"
              style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)' }}
            >
              <span className="font-medium text-sm" style={{ color: 'var(--text)' }}>{formatPeriodRange(new Date(periodStart), new Date(periodRows[0].period_end))}</span>
              <span className="text-xs shrink-0" style={{ color: 'var(--muted)' }}>
                {periodRows.length} sent · {new Date(periodRows[0].sent_at).toLocaleString()}
              </span>
            </div>
            <div>
              {periodRows.map(row => (
                <div
                  key={row.id}
                  className="flex items-center justify-between gap-4"
                  style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)' }}
                >
                  <div style={{ minWidth: 0 }}>
                    <p
                      className="text-sm"
                      style={{ color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    >
                      {row.subject ?? '(subject not recorded)'}
                    </p>
                    <p className="text-xs" style={{ color: 'var(--muted)' }}>
                      {subscriberEmail(row)} · {row.article_ids?.length ?? 0} article{row.article_ids?.length === 1 ? '' : 's'}
                    </p>
                  </div>
                  {row.subject ? (
                    <a
                      href={`/api/digest/history/${row.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm px-3 py-1 rounded-lg transition-colors shrink-0"
                      style={{ background: 'var(--bg-secondary)', color: 'var(--muted)', border: '1px solid var(--border)' }}
                    >
                      View
                    </a>
                  ) : (
                    <span className="text-xs shrink-0" style={{ color: 'var(--muted)' }}>No copy</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
