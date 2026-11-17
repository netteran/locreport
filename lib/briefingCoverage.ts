const COVERAGE_COLUMNS = ', monthly_period, report_start_date, report_end_date'
const COVERAGE_FIELD = /\b(?:monthly_period|report_start_date|report_end_date)\b/

/** Older deployments can display briefings before the optional coverage columns exist. */
export async function withOptionalBriefingCoverage<Result extends { error: { code?: string; message?: string } | null }>(
  query: (coverageColumns: string) => PromiseLike<Result>
): Promise<Result> {
  const result = await query(COVERAGE_COLUMNS)
  const error = result.error
  if (error && ['42703', 'PGRST204'].includes(error.code || '') && COVERAGE_FIELD.test(error.message || '')) {
    return query('')
  }
  return result
}
