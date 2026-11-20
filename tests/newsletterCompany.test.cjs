const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), ts = require('typescript')
const { NextRequest } = require('next/server')
function load(file, dependencies = {}) {
  const m = { exports: {} }
  new Function('exports', 'require', 'module', ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText)(m.exports, id => dependencies[id] || require(id), m)
  return m.exports
}
const utils = load('lib/utils.ts', { './monthlyReportSlugs': load('lib/monthlyReportSlugs.ts') })
const digest = load('lib/email/digest.ts', {
  '@/lib/data/locstock': load('lib/data/locstock.ts'),
  '@/lib/data/directory': { DIRECTORY_CATEGORIES: [{ value: 'lsp', label: 'LSPs' }] },
  '@/lib/utils': utils, '@/lib/email/send': { SITE_URL: 'https://locreport.com' },
  '@/lib/email/companyLogo': load('lib/email/companyLogo.ts'),
})
const companyLinks = load('lib/email/editionCompany.ts')
const { editionCompanySlug } = companyLinks
const entry = (slug, extra = {}) => ({ slug, name: slug.toUpperCase(), category: 'lsp',
  description: 'Language services for buyers.', long_description: 'Language services for buyers. A second sentence.',
  logo_url: `https://example.test/${slug}.png`, ...extra })
const companies = [entry('alpha'), entry('beta'), entry('gamma')]
const date = new Date('2026-11-18T12:00:00Z')
const slugOf = company => company?.url.split('/').pop()

test('automatic selection stays stable through the week and ignores directory ordering', () => {
  const original = JSON.stringify(companies)
  const selected = digest.pickCompanyOfWeek(companies, date)
  for (const instant of ['2026-11-16T08:00:00Z', '2026-11-20T12:00:00Z']) {
    assert.deepEqual(digest.pickCompanyOfWeek([...companies].reverse(), new Date(instant)), selected)
  }
  assert.equal(JSON.stringify(companies), original)
})

test('explicit refresh avoids both the automatic pick and the most recent working selection', () => {
  const pool = companies.slice(0, 2)
  let previous = slugOf(digest.pickCompanyOfWeek(pool, date))
  const firstRefresh = digest.pickCompanyOfWeek(pool, date, { seed: 'fresh-seed' })
  assert.notEqual(slugOf(firstRefresh), previous)
  previous = slugOf(firstRefresh)
  for (let attempt = 0; attempt < 8; attempt++) {
    const next = digest.pickCompanyOfWeek(pool, date, { seed: 'fresh-seed-' + attempt, excludeSlug: previous })
    assert.notEqual(slugOf(next), previous)
    previous = slugOf(next)
  }
})

test('refresh keeps language-company eligibility and prefers safe logos among alternatives', () => {
  const pool = [entry('current'), entry('alternative'), entry('without-logo', { logo_url: '' }),
    entry('tech', { category: 'tech-platform' }), entry('outsourcing', { category: 'bpo' }),
    entry('undescribed', { description: '', long_description: '' })]
  assert.equal(slugOf(digest.pickCompanyOfWeek(pool, date, { seed: 'refresh', excludeSlug: 'current' })), 'alternative')
  const fallback = digest.pickCompanyOfWeek([entry('current'), entry('no-email-logo', { logo_url: 'https://example.test/logo.svg' })], date,
    { seed: 'refresh', excludeSlug: 'current' })
  assert.equal(slugOf(fallback), 'no-email-logo', 'a different eligible company can be shown without a logo')
  assert.equal(fallback.logoUrl, null)
})

test('empty and single-company pools remain usable without selecting ineligible entries', () => {
  for (const selection of [undefined, { seed: 'refresh', excludeSlug: 'only' }]) {
    assert.equal(digest.pickCompanyOfWeek([], date, selection), null)
    assert.equal(digest.pickCompanyOfWeek([entry('bpo', { category: 'bpo' })], date, selection), null)
    assert.equal(slugOf(digest.pickCompanyOfWeek([entry('only'), entry('tech', { category: 'tech-platform' })], date, selection)), 'only')
  }
})

test('the current company comes only from real links inside its editable Markdown section', () => {
  const before = '[Intro profile](https://locreport.com/compass/directory/intro)\n\n'
  const after = '\n\n## New in the directory\n\n[Other](https://locreport.com/compass/directory/other)'
  for (const link of ['[**Company**](https://locreport.com/compass/directory/chosen)',
    '[Company](/compass/directory/chosen/)', '[Company](https://www.locreport.com/compass/directory/chosen?from=weekly#profile)',
    '[Company][profile]\n\n[profile]: https://locreport.com/compass/directory/chosen']) {
    assert.equal(editionCompanySlug(before + '## Company of the week\n\n' + link + after), 'chosen')
  }
  assert.equal(editionCompanySlug('## COMPANY OF THE WEEK\n\n### Company details\n\n- [Chosen](/compass/directory/chosen)'), 'chosen')
  for (const body of [before + after, before + '## Company of the week\n\nNo profile selected.' + after,
    '```md\n## Company of the week\n[Company](/compass/directory/code)\n```',
    '## Company of the week\n\n`[Company](/compass/directory/code)`' + after,
    '## Company of the week\n\n[Company](https://locreport.com.evil.test/compass/directory/fake)' + after,
    '## Company of the week\n\n![Logo](https://locreport.com/compass/directory/image)' + after]) {
    assert.equal(editionCompanySlug(body), null)
  }
})

function apiFixture() {
  const editions = new Map(), writes = [], builds = []
  let admin = false
  const periodEnd = new Date(), periodStart = new Date(periodEnd.getTime() - 7 * 86400000)
  const article = { id: 'story', slug: 'story', title: 'The story', published_at: periodEnd.toISOString() }
  const service = { from(table) {
    let selectedDate
    const q = { select() { return q }, eq(_key, value) { selectedDate = value; return q }, in() { return q },
      gte() { return q }, lt() { return q }, order() { return q }, limit() { return q }, or() { return q },
      async maybeSingle() { return { data: table === 'weekly_newsletter_editions' ? editions.get(selectedDate) || null : null, error: null } },
      async upsert(row) { assert.equal(table, 'weekly_newsletter_editions'); writes.push(row); editions.set(row.edition_date, row); return { error: null } },
      then(resolve, reject) { return Promise.resolve({ data: table === 'articles' ? [article] : [], error: null }).then(resolve, reject) }
    }
    return q
  } }
  const weekly = load('lib/email/weeklyNote.ts')
  const issue = load('lib/email/issue.ts', {
    '@/lib/data/directory': { DIRECTORY: [] }, '@/lib/directory': { fetchDirectoryEntries: async () => companies.slice(0, 2) },
    '@/lib/email/digest': digest, '@/lib/email/weeklyNote': weekly,
    '@/lib/email/period': { fetchPeriodArticles: async () => ({ data: [article], error: null }) }
  })
  const trackedIssue = { buildIssue: async (...args) => { builds.push(args[3]); return issue.buildIssue(...args) } }
  const edition = load('lib/email/edition.ts', { './issue': trackedIssue, './weeklyNote': weekly,
    '@/lib/utils': utils, './send': { SITE_URL: 'https://locreport.com' } })
  const routes = load('app/api/digest/edition/route.ts', {
    '@/lib/adminAuth': { requireAdmin: async () => admin ? {} : null },
    '@/lib/supabase/server': { createServiceClient: () => service },
    '@/lib/email/period': { currentPeriod: () => ({ periodStart, periodEnd }) },
    '@/lib/email/weeklyNote': weekly, '@/lib/email/edition': edition,
    '@/lib/email/issue': trackedIssue, '@/lib/email/editionCompany': companyLinks
  })
  return { editions, writes, builds, edition, service, periodStart, periodEnd,
    authorize() { admin = true },
    get: (query = '') => routes.GET(new NextRequest('http://localhost/api/digest/edition' + query)),
    put: body => routes.PUT(new NextRequest('http://localhost/api/digest/edition', { method: 'PUT',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })) }
}

test('refresh changes the working company, preserves saved copy, and freezes the selection only on save', async () => {
  const f = apiFixture()
  assert.equal((await f.get('?refresh=1')).status, 401)
  assert.equal(f.builds.length, 0)
  f.authorize()
  const initial = await (await f.get()).json()
  const initialSlug = editionCompanySlug(initial.body_markdown)
  assert.ok(initialSlug)
  assert.equal(editionCompanySlug((await (await f.get()).json()).body_markdown), initialSlug)
  assert.deepEqual(f.builds, [undefined, undefined], 'ordinary reads must keep automatic weekly selection')
  const saved = await (await f.put(initial)).json()
  const refreshResponse = await f.get('?refresh=1&exclude_company=' + initialSlug)
  assert.equal(refreshResponse.headers.get('Cache-Control'), 'no-store')
  const refreshed = await refreshResponse.json()
  const refreshedSlug = editionCompanySlug(refreshed.body_markdown)
  assert.notEqual(refreshedSlug, initialSlug)
  assert.equal(refreshed.saved, false)
  assert.equal(refreshed.revision, saved.revision)
  assert.equal(f.writes.length, 1, 'refresh must not replace reviewed content')
  assert.equal((await (await f.get()).json()).body_markdown, saved.body_markdown)
  const again = await (await f.get('?refresh=1&exclude_company=' + refreshedSlug)).json()
  assert.notEqual(editionCompanySlug(again.body_markdown), refreshedSlug, 'exclude the unsaved working company, not just the stored one')
  assert.notEqual(f.builds.at(-1).seed, f.builds.at(-2).seed)
  assert.equal(f.builds.at(-1).excludeSlug, refreshedSlug)
  const updatedResponse = await f.put(refreshed)
  assert.equal(updatedResponse.status, 200)
  const updated = await updatedResponse.json()
  const buildCount = f.builds.length
  const frozen = await f.edition.resolveEdition(f.service, f.periodStart, f.periodEnd)
  assert.equal(frozen.bodyMarkdown, refreshed.body_markdown)
  assert.equal(frozen.revision, updated.revision)
  assert.equal(f.builds.length, buildCount, 'saved preview/send resolution must not draw another company')
  assert.equal((await f.put(saved)).status, 409, 'refresh must not remove stale-save protection')
})

test('refresh without a working-company parameter uses the saved profile and ignores invalid exclusions', async () => {
  const f = apiFixture(); f.authorize()
  const initial = await (await f.get()).json()
  await f.put(initial)
  const slug = editionCompanySlug(initial.body_markdown)
  for (const query of ['?refresh=1', '?refresh=1&exclude_company=bad%2Fpath']) {
    const response = await f.get(query)
    assert.equal(response.status, 200)
    assert.notEqual(editionCompanySlug((await response.json()).body_markdown), slug)
    assert.equal(f.builds.at(-1).excludeSlug, slug)
  }
  assert.equal(f.writes.length, 1)
})

test('company selection keeps uploaded SVG logos as versioned PNG links in the edition', async t => {
  const oldStorage = process.env.NEXT_PUBLIC_SUPABASE_URL
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://storage.example.test'
  t.after(() => {
    if (oldStorage === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL
    else process.env.NEXT_PUBLIC_SUPABASE_URL = oldStorage
  })

  const storageLogo = 'https://storage.example.test/storage/v1/object/public/directory-logos/beta.svg?v=123'
  const f = apiFixture()
  const route = load('app/api/digest/companies/route.ts', {
    '@/lib/adminAuth': { requireAdmin: async () => ({}) },
    '@/lib/supabase/server': { createServiceClient: () => ({}) },
    '@/lib/directory': { fetchDirectoryEntries: async () => [entry('beta', { logo_url: storageLogo })] },
    '@/lib/email/digest': digest,
    '@/lib/email/edition': f.edition,
  })
  const response = await route.GET(new NextRequest('http://localhost/api/digest/companies?slug=beta'))
  assert.equal(response.status, 200)
  const { section } = await response.json()
  const logo = 'https://locreport.com/newsletter-assets/company/beta.svg.png?v=123'
  assert.equal(editionCompanySlug(section), 'beta')
  assert.ok(section.includes(logo))

  const { editedDigestEmail } = load('lib/email/templates.ts')
  assert.ok(editedDigestEmail({ editionDate: '2026-11-20', bodyMarkdown: section,
    manageUrl: 'https://locreport.com/subscribe/manage' }).includes(`<img src="${logo}"`))

  const sharp = require('sharp')
  const converter = load('app/newsletter-assets/company/[file]/route.ts', {
    sharp: { default: sharp },
    '@/lib/email/companyLogo': load('lib/email/companyLogo.ts'),
  })
  const originalFetch = global.fetch
  t.after(() => { global.fetch = originalFetch })
  let requests = 0
  global.fetch = async (url, options) => {
    requests++
    assert.equal(url.href, storageLogo)
    assert.equal(options.redirect, 'error')
    return new Response('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="40"><rect width="20" height="40" fill="blue"/></svg>',
      { headers: { 'Content-Type': 'image/svg+xml' } })
  }
  const invalid = await converter.GET(new NextRequest(logo), { params: Promise.resolve({ file: '../beta.svg.png' }) })
  assert.equal(invalid.status, 404)
  assert.equal(requests, 0)
  const png = await converter.GET(new NextRequest(logo), { params: Promise.resolve({ file: 'beta.svg.png' }) })
  assert.equal(png.status, 200)
  assert.equal(png.headers.get('Content-Type'), 'image/png')
  const metadata = await sharp(Buffer.from(await png.arrayBuffer())).metadata()
  assert.deepEqual([metadata.format, metadata.width, metadata.height], ['png', 112, 112])
})

test('choosing a company replaces only the real company section and preserves other edits', () => {
  const { replaceEditionCompany } = companyLinks
  const top = '[story]: /articles/story\n\n\tA code example\n\n```md\n## Company of the week\nExample only\n```\n\n## Top story\n\n[Edited lead][story]\n\n'
  const end = '## Fact Flow\n\n- An edited fact\n\n## More from LocReport\n\nAn edited closing'
  const selected = '## Company of the week\n\n[Beta](/compass/directory/beta)'
  const expected = top + selected + '\n\n' + end
  assert.equal(replaceEditionCompany(top + '## Company of the week\n\n[Old](/compass/directory/old)\n\n' + end, selected), expected)
  assert.equal(replaceEditionCompany(top + end, selected), expected)
  assert.equal(editionCompanySlug(expected), 'beta')
  assert.equal(replaceEditionCompany('', selected), selected)
  assert.equal(replaceEditionCompany('Editor note', selected), 'Editor note\n\n' + selected)
})

test('manual selection survives the existing save, reload and scheduled-issue resolution', async () => {
  const f = apiFixture(); f.authorize()
  const initial = await (await f.get()).json()
  const body = companyLinks.replaceEditionCompany(initial.body_markdown,
    f.edition.companySectionMarkdown(digest.digestCompanyFromEntry(companies[2])))
  const edit = { ...initial, subject: 'Edited subject', body_markdown: 'Edited opening.\n\n' + body }
  assert.equal((await f.put(edit)).status, 200)
  const saved = await (await f.get()).json()
  const resolved = await f.edition.resolveEdition(f.service, f.periodStart, f.periodEnd)
  assert.equal(editionCompanySlug(saved.body_markdown), 'gamma')
  assert.equal(resolved.subject, 'Edited subject')
  assert.equal(resolved.bodyMarkdown, edit.body_markdown)
})

test('the newsletter LocStock brief averages and ranks only language services companies', () => {
  const start = new Date('2026-11-13T13:00:00Z')
  const end = new Date('2026-11-20T13:00:00Z')
  const quote = (ticker, close) => ({ ticker, data: { history: [
    { date: '2026-11-13', close: 100 },
    { date: '2026-11-20', close },
  ] } })
  const unrelated = [quote('NVDA', 150), quote('AMN', 80), quote('UNKNOWN', 200)]
  assert.equal(digest.summarizeMarket([...unrelated, quote('RWS.L', 101)], start, end), null)
  const market = digest.summarizeMarket([...unrelated, quote('RWS.L', 110), quote('ZOO.L', 98)], start, end)
  assert.equal(market.tracked, 2)
  assert.equal(Math.round(market.avgPct), 4)
  assert.deepEqual(market.movers.map(mover => mover.symbol), ['RWS', 'ZOO'])
})
