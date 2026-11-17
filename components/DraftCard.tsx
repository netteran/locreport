import Link from 'next/link'
import { Draft } from '@/lib/types'
import { Badge } from '@/components/ui/badge'
import { briefingCoverageLabel } from '@/lib/briefingDisplay'

function statusVariant(status: Draft['status']) {
  if (status === 'approved') return 'success'
  if (status === 'rejected') return 'danger'
  if (status === 'rerun') return 'rerun'
  if (status === 'rerunning') return 'muted'
  return 'warning'
}

function statusLabel(status: Draft['status']) {
  if (status === 'rerun') return 'Re-run draft'
  if (status === 'rerunning') return 'Re-running…'
  return status
}

export function DraftCard({ draft }: { draft: Draft }) {
  const coverage = draft.article_type === 'monthly-summary' ? briefingCoverageLabel(draft) : null
  const date = new Date(draft.created_at).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric',
  })
  return (
    <div className="border-b border-gray-100 py-4 last:border-0 flex items-start justify-between gap-4">
      <div>
        <Link href={`/admin/drafts/${draft.id}`} className="font-medium text-[#15191C] hover:text-[#0F6E52]">
          {draft.title}
        </Link>
        {draft.article_type === 'monthly-summary' && <p className="text-xs text-[#5B665F] mt-1">Monthly Briefing{coverage ? ` · Coverage: ${coverage}` : ''}</p>}
        <p className="text-xs text-[#5B665F] mt-1">{date}{draft.source_url && (() => { try { return ` · ${new URL(draft.source_url!).hostname}` } catch { return ` · ${draft.source_url}` } })()}</p>
      </div>
      <Badge variant={statusVariant(draft.status)}>{statusLabel(draft.status)}</Badge>
    </div>
  )
}
