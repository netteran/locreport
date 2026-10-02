// Annual reports are hand-written static pages with no `articles` row, so
// their lead image can't live in `articles.image_url` the way a monthly
// report's does. It is stored in the `settings` table instead, one row per
// report under `reportImageKey(slug)`, as JSON `{ url, alt }`. Client-safe:
// the server-side reader is in lib/reportImage.ts.

export interface AnnualReport {
  slug: string
  title: string
  /** Month + year shown on the Reports hub card. */
  date: string
  description: string
}

export const ANNUAL_REPORTS: AnnualReport[] = [
  {
    slug: '2026-annual-global-market-report',
    title: '2026 Annual Global Market Report',
    date: 'April 2026',
    description: 'A data-rich strategic brief covering market evolution, AI disruption, competitive dynamics, and forward-looking implications for language services stakeholders.',
  },
]

export interface ReportImage {
  url: string
  alt: string
}

export function reportImageKey(slug: string): string {
  return `report_image:${slug}`
}

export function annualReportPath(slug: string): string {
  return `/reports/${slug}`
}
