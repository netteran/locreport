// Editions verified in the public archive. Slugs listed here were published
// before the edition-title convention and remain permanent URL aliases.
export const MONTHLY_REPORT_EDITIONS = [
  ['2025-11', 'November', 'monthly-report-november-2025'],
  ['2025-12', 'December', 'monthly-report-december-2025'],
  ['2026-01', 'January', 'monthly-report-january-2026'],
  ['2026-02', 'February', 'monthly-report-february-2026'],
  ['2026-03', 'March', 'monthly-report-march-2026'],
  ['2026-04', 'April', 'monthly-report-april-2026'],
  ['2026-05', 'May', 'monthly-report-may-2026'],
  ['2026-06', 'June', 'june-2026-industry-intelligence-report'],
  ['2026-07', 'July', 'july-2026-industry-intelligence-report-localization-and-translation'],
  ['2026-08', 'August', 'august-2026-industry-intelligence-report'],
  ['2026-09', 'September', 'monthly-report-september-2026'],
  ['2026-10', 'October', 'october-2026-industry-intelligence-report-localization-and-translation'],
].map(([period, month, oldSlug]) => {
  const [year, number] = period.split('-')
  const slug = `${month.toLowerCase()}-${year}-localization-industry-report`
  return { month, year, number, oldSlug, slug }
})

const canonicalByOldSlug = new Map(MONTHLY_REPORT_EDITIONS.map(({ oldSlug, slug }) => [oldSlug, slug]))
const oldByCanonicalSlug = new Map(MONTHLY_REPORT_EDITIONS.map(({ oldSlug, slug }) => [slug, oldSlug]))

export function canonicalMonthlyReportSlug(slug: string): string {
  return canonicalByOldSlug.get(slug) ?? slug
}

export function previousMonthlyReportSlug(slug: string): string | undefined {
  return oldByCanonicalSlug.get(slug)
}
