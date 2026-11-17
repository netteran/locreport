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
