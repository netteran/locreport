const { test } = require('node:test')
const assert = require('node:assert/strict')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

const { load } = require('./fixtures/typescript.cjs')

const display = load('lib/briefingDisplay.ts')
const coverage = load('lib/briefingCoverage.ts')
const { briefingCoverageLabel } = display

test('stored coverage wins over publication timing and legacy month metadata', () => {
  assert.equal(briefingCoverageLabel({ report_start_date: '2026-10-01', report_end_date: '2026-10-31',
    monthly_period: '2026-11', published_at: '2026-11-05T10:00:00Z' }), 'October 2026')
  assert.equal(briefingCoverageLabel({ report_start_date: '2028-02-01', report_end_date: '2028-02-29' }), 'February 2028')
})

test('partial, single-day and cross-month coverage retain their exact dates', () => {
  assert.equal(briefingCoverageLabel({ report_start_date: '2026-11-01', report_end_date: '2026-11-15' }), 'Nov 1, 2026 – Nov 15, 2026')
  assert.equal(briefingCoverageLabel({ report_start_date: '2026-03-29', report_end_date: '2026-03-29' }), 'Mar 29, 2026')
  assert.equal(briefingCoverageLabel({ report_start_date: '2026-12-20', report_end_date: '2027-01-10' }), 'Dec 20, 2026 – Jan 10, 2027')
})

test('legacy reports use a valid recorded month but unknown coverage is never guessed', () => {
  assert.equal(briefingCoverageLabel({ monthly_period: '2026-09' }), 'September 2026')
  assert.equal(briefingCoverageLabel({ published_at: '2026-11-05T10:00:00Z' }), null)
  assert.equal(briefingCoverageLabel({ monthly_period: '2026-13' }), null)
  assert.equal(briefingCoverageLabel({ report_start_date: '2026-02-30', report_end_date: '2026-03-05' }), null)
  assert.equal(briefingCoverageLabel({ report_start_date: '2026-11-10', report_end_date: '2026-11-01' }), null)
  assert.equal(briefingCoverageLabel({ report_start_date: '2026-11-01', monthly_period: '2026-11' }), 'November 2026')
})

function reportsPage(posts) {
  const query = { select() { return query }, eq() { return query }, order() { return query }, returns: async () => ({ data: posts.map(post => ({ ...post, content_type: 'report' })), error: null }) }
  return load('app/(stories)/reports/page.tsx', {
    'next/link': { default: ({ children, ...props }) => React.createElement('a', props, children) },
    '@/lib/supabase/server': { createPublicClient: () => ({ from: () => query }) },
    '@/lib/supabase/required': { required: result => result.data },
    '@/lib/utils': { safeImageUrl: () => null },
    '@/lib/briefingDisplay': display,
    '@/lib/briefingCoverage': coverage,
    '@/lib/reports': load('lib/reports.ts'),
    '@/lib/reportImage': { getReportImage: async () => null },
  }).default
}

test('monthly archive distinguishes a delayed briefing coverage from its publication date', async () => {
  const Page = reportsPage([{ id: 'briefing', title: 'October industry briefing', slug: 'october-briefing',
    excerpt: 'An editorial assessment.', report_start_date: '2026-10-01', report_end_date: '2026-10-31',
    published_at: '2026-11-05T10:00:00Z', signal_ids: ['legacy-signal'] }])
  const html = renderToStaticMarkup(await Page())
  assert.match(html, /October 2026 Localization Industry Report/)
  assert.match(html, /Published Nov 5, 2026/)
  assert.doesNotMatch(html, /Coverage: November 2026|legacy-signal/)
  assert.match(html, /href="\/reports\/october-briefing\/"/)
  assert.match(html, /href="\/reports\/2026-annual-global-market-report\/"/)
})

test('legacy briefing archive without coverage records only identifies publication timing', async () => {
  const Page = reportsPage([{ id: 'legacy', title: 'Older briefing', slug: 'older-briefing', published_at: '2026-11-05T10:00:00Z' }])
  const html = renderToStaticMarkup(await Page())
  assert.match(html, /Published Nov 5, 2026/)
  assert.doesNotMatch(html, /Coverage:/)
})

test('legacy monthly titles normalize only when the edition states its month', () => {
  assert.equal(display.monthlyReportTitle({ title: 'Monthly Report: May 2026' }), 'May 2026 Localization Industry Report')
  assert.equal(display.monthlyReportTitle({ title: 'Monthly Report — September 2026' }), 'September 2026 Localization Industry Report')
  assert.equal(display.monthlyReportTitle({ title: 'June 2026 Industry Intelligence Report' }), 'June 2026 Localization Industry Report')
  assert.equal(display.monthlyReportTitle({ title: 'Older briefing' }), 'Older briefing')
  assert.equal(display.monthlyReportTitle({ title: 'Monthly Report: May 2026',
    report_start_date: '2026-05-01', report_end_date: '2026-05-15' }), 'May 1, 2026 – May 15, 2026 Localization Industry Report')
  assert.equal(display.monthlyReportSubtitle('A monthly roundup for May 2026 based on 135 articles.'), null)
  assert.equal(display.monthlyReportSubtitle('An editorial assessment.'), 'An editorial assessment.')
})
