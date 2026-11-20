export interface BriefingCoverage {
  report_start_date?: string | null
  report_end_date?: string | null
  monthly_period?: string | null
}

function calendarDate(value: string | null | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T12:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null
}

/** Coverage is editorial metadata, never inferred from the publication date. */
export function briefingCoverageLabel(report: BriefingCoverage): string | null {
  const start = calendarDate(report.report_start_date)
  const end = calendarDate(report.report_end_date)
  const monthLabel = (date: Date) => date.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })

  if (start && end && start <= end) {
    const nextDay = new Date(end.getTime() + 86400000)
    if (start.getUTCDate() === 1 && nextDay.getUTCDate() === 1 &&
      start.getUTCFullYear() === end.getUTCFullYear() && start.getUTCMonth() === end.getUTCMonth()) {
      return monthLabel(start)
    }
    const dayLabel = (date: Date) => date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    return start.getTime() === end.getTime() ? dayLabel(start) : `${dayLabel(start)} – ${dayLabel(end)}`
  }

  const legacyMonth = /^\d{4}-\d{2}$/.test(report.monthly_period || '')
    ? calendarDate(`${report.monthly_period}-01`) : null
  return legacyMonth ? monthLabel(legacyMonth) : null
}

// Older editions record their coverage month in the title only.
const MONTH = '(January|February|March|April|May|June|July|August|September|October|November|December)'
const LEGACY_MONTH_FIRST = new RegExp(`^${MONTH} (\\d{4}) (?:Localization Industry Report|Industry Intelligence Report)(?::.*)?$`, 'i')
const LEGACY_REPORT_FIRST = new RegExp(`^Monthly (?:Report|Briefing)(?::|\\s+[—–-]) ${MONTH} (\\d{4})$`, 'i')

export function monthlyReportTitle(report: BriefingCoverage & { title: string }): string {
  const coverage = briefingCoverageLabel(report)
  if (coverage) return `${coverage} Localization Industry Report`

  const legacy = report.title.trim().match(LEGACY_MONTH_FIRST) ?? report.title.trim().match(LEGACY_REPORT_FIRST)
  if (!legacy) return report.title
  const month = legacy[1][0].toUpperCase() + legacy[1].slice(1).toLowerCase()
  return `${month} ${legacy[2]} Localization Industry Report`
}

export function monthlyReportSubtitle(excerpt: string | null | undefined): string | null {
  const text = excerpt?.trim()
  return text && !/^A monthly roundup for .+ based on [\d,]+ articles?\.?$/i.test(text) ? text : null
}
