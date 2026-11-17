import Link from 'next/link'
import { createServiceClient } from '@/lib/supabase/server'
import { ANNUAL_REPORTS, annualReportPath } from '@/lib/reports'
import { getReportImage } from '@/lib/reportImage'
import { articleHref, safeImageUrl } from '@/lib/utils'
import { AnnualImageForm } from './AnnualImageForm'
import { briefingCoverageLabel, type BriefingCoverage } from '@/lib/briefingDisplay'
import { withOptionalBriefingCoverage } from '@/lib/briefingCoverage'
import type { Article } from '@/lib/types'

export const dynamic = 'force-dynamic'

type ReportImageRow = Pick<Article, 'id' | 'title' | 'slug' | 'published_at' | 'image_url'> & BriefingCoverage

// One place for report lead images. Annual reports are static pages, so their
// image is edited inline here; monthly reports are articles and link to the
// article editor, which has the same image field.
export default async function AdminReportsPage() {
  const annual = await Promise.all(ANNUAL_REPORTS.map(async r => ({ ...r, image: await getReportImage(r.slug) })))
  const service = createServiceClient()
  const { data: monthly } = await withOptionalBriefingCoverage(coverageColumns => service
    .from('articles')
    .select('id, title, slug, published_at, image_url' + coverageColumns)
    .eq('article_type', 'monthly-summary')
    .order('published_at', { ascending: false })
    .returns<ReportImageRow[]>()
  )

  return (
    <div className="max-w-[760px]">
      <h1 className="text-2xl font-bold mb-2" style={{ color: 'var(--text)' }}>Briefings &amp; report archive</h1>
      <p className="text-sm mb-8" style={{ color: 'var(--muted)' }}>
        Manage lead images for monthly briefings and archived reports. Images appear on the publication, its listing card and social-media previews.
      </p>

      <h2 className="text-lg font-semibold mb-3" style={{ color: 'var(--text)' }}>Monthly Briefing</h2>
      {(monthly ?? []).length === 0 && (
        <p className="text-sm" style={{ color: 'var(--muted)' }}>No monthly briefings yet.</p>
      )}
      {(monthly ?? []).map(m => {
        const image = safeImageUrl(m.image_url)
        return (
          <div key={m.id} className="py-3 flex items-center gap-4" style={{ borderTop: '1px solid var(--border)' }}>
            {image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={image} alt="" className="shrink-0 object-cover rounded" style={{ width: 96, height: 50, border: '1px solid var(--border)' }} />
            ) : (
              <span className="shrink-0 text-xs flex items-center justify-center rounded" style={{ width: 96, height: 50, border: '1px dashed var(--border)', color: 'var(--muted)' }}>
                No image
              </span>
            )}
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm truncate" style={{ color: 'var(--text)' }}>
                <Link href={articleHref(m.slug)} target="_blank" className="hover:underline">{m.title}</Link>
              </p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
                {briefingCoverageLabel(m) ? `Coverage: ${briefingCoverageLabel(m)} · ` : ''}
                Published {new Date(m.published_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Europe/Warsaw' })}
              </p>
            </div>
            <Link
              href={`/admin/monthly/articles/${m.id}`}
              className="text-sm px-3 py-1 rounded-lg shrink-0"
              style={{ background: 'var(--bg-secondary)', color: 'var(--muted)', border: '1px solid var(--border)' }}
            >
              {image ? 'Change image' : 'Add image'}
            </Link>
          </div>
        )
      })}

      <h2 className="text-lg font-semibold mb-3 mt-8" style={{ color: 'var(--text)' }}>Annual report archive</h2>
      {annual.map(r => (
        <div key={r.slug} className="py-4 mb-6" style={{ borderTop: '1px solid var(--border)' }}>
          <p className="font-medium text-sm mb-3" style={{ color: 'var(--text)' }}>
            <Link href={annualReportPath(r.slug)} target="_blank" className="hover:underline">{r.title}</Link>
            <span style={{ color: 'var(--muted)' }}> · {r.date}</span>
          </p>
          <AnnualImageForm slug={r.slug} initialUrl={r.image?.url ?? ''} initialAlt={r.image?.alt ?? ''} />
        </div>
      ))}
    </div>
  )
}
