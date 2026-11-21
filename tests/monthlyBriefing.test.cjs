const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { NextRequest } = require('next/server')
const { load } = require('./fixtures/typescript.cjs')
const monthly = load('lib/monthlyBriefing.ts')
const prompts = load('lib/prompts.ts')
const citationStyle = load('lib/citationStyle.ts')
const source = { id: 'candidate', title: 'Supplier changes pricing', source_url: 'https://publisher.test/pricing', source_name: 'Publisher',
  source_published_at: '2026-10-15', created_at: '2026-10-15', extracted_facts: 'The supplier announced a pricing change.', quality: 'snippet', event_id: 'event-1', review_reason: null }
function database({ articles = [], facts = [], sources = [source], undated = [], previous = [], duplicate = [], draftDuplicate = [], errorTable = null, savedPrompt = null } = {}) {
  const calls = [], inserts = [], insertTables = []
  return { calls, inserts, insertTables, from(table) {
    const filters = [], call = { table, filters }; calls.push(call)
    const result = () => {
      const data = table === 'articles' ? filters.some(([k, v]) => k === 'or' && v.includes('slug.ilike')) ? duplicate
        : filters.some(([k, v]) => k === 'article_type' && v === 'monthly-summary') ? previous : articles
        : table === 'drafts' ? draftDuplicate : table === 'facts' ? facts : table === 'source_candidates' ? filters.some(([k]) => k === 'is') ? undated : sources : []
      return { data, error: table === errorTable ? { message: 'Database unavailable' } : null }
    }
    const q = {
      select(columns) { call.columns = columns; return q },
      eq(k, v) { filters.push([k, v]); return q }, in(k, v) { filters.push([k, v]); return q },
      is(k, v) { filters.push(['is', k, v]); return q },
      gte(k, v) { filters.push(['gte', k, v]); return q }, lt(k, v) { filters.push(['lt', k, v]); return q },
      lte(k, v) { filters.push(['lte', k, v]); return q }, or(v) { filters.push(['or', v]); return q },
      order() { return q }, limit(n) { call.limit = n; return q },
      insert(data) { inserts.push(data); insertTables.push(table); return q },
      maybeSingle: async () => ({ data: savedPrompt ? { value: savedPrompt } : null, error: null }),
      single: async () => ({ data: { id: 'report' }, error: null }),
      then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject) }
    }
    return q
  } }
}

test('monthly reporting boundaries use Warsaw calendar months and DST', () => {
  const rollover = monthly.monthlyPeriod(new Date('2026-10-31T23:30:00Z'))
  assert.equal(rollover.period, '2026-10')
  assert.equal(rollover.startDate, '2026-09-30T22:00:00.000Z')
  assert.equal(rollover.endDate, '2026-10-31T23:00:00.000Z')
  const january = monthly.monthlyPeriod(new Date('2027-01-01T00:00:00Z'))
  assert.equal(january.period, '2026-12')
})

test('briefings can draw on facts and waiting evidence with no published articles', async () => {
  const db = database({ facts: [{ id: 'fact', content: 'A reported pricing change', source_url: source.source_url, event_id: 'event-1' }],
    undated: [{ ...source, id: 'undated', source_published_at: null }],
    previous: [{ title: 'Earlier briefing', content: 'We will watch buyer costs.', slug: 'earlier', published_at: '2026-10-01' }] })
  const evidence = await monthly.loadMonthlyEvidence(db, monthly.monthlyPeriod(new Date('2026-11-16')))
  assert.equal(evidence.hasCurrentEvidence, true)
  assert.deepEqual(evidence.counts, { articles: 0, facts: 1, sources: 2 })
  assert.match(evidence.context.source_evidence[1].timing, /background only/)
  assert.match(evidence.context.source_evidence[0].evidence_status, /not independently verified/)
  assert.equal(evidence.context.previous_briefing.url, '/reports/earlier/')
  const factsQuery = db.calls.find(c => c.table === 'facts')
  assert.ok(factsQuery.filters.some(([k, v]) => k === 'status' && v === 'published'))
  for (const c of db.calls.filter(c => c.table === 'source_candidates')) {
    assert.deepEqual(c.filters.find(([k]) => k === 'status'), ['status', ['available', 'reserved', 'used']])
    assert.ok(c.filters.some(([k, v]) => k === 'processing_status' && v === 'ready'))
  }
})

test('undated sources or old briefing alone cannot establish current monthly activity', async () => {
  const db = database({ sources: [], undated: [{ ...source, source_published_at: null }],
    previous: [{ title: 'Prior analysis', content: 'Old evidence', slug: 'prior' }] })
  const e = await monthly.loadMonthlyEvidence(db, monthly.monthlyPeriod())
  assert.equal(e.hasCurrentEvidence, false)
})

test('query failures are not silently presented as a quiet month', async () => {
  await assert.rejects(monthly.loadMonthlyEvidence(database({ errorTable: 'facts' }), monthly.monthlyPeriod()), /published facts: Database unavailable/)
})

test('only supplied evidence URLs may be cited, and malformed reports cannot publish', () => {
  const urls = new Set(['https://publisher.test/pricing', '/articles/analysis'])
  monthly.validateBriefing('# October briefing\n\n[Reported prices](https://publisher.test/pricing) differ from [our analysis](/articles/analysis).', urls)
  for (const output of ['', '# Briefing\nNo evidence links.', '# Briefing\n[Claim](https://invented.test)', 'Missing title [source](https://publisher.test/pricing)']) {
    assert.throws(() => monthly.validateBriefing(output, urls), /nothing was published/)
  }
})

function generator(db, { authorized = true, content = '# Monthly briefing\n\nThe [supplier pricing change](https://publisher.test/pricing) raises a buyer question.', finish = 'stop' } = {}) {
  const modelCalls = []
  const route = load('app/api/monthly-report/route.ts', {
    '@/lib/supabase/server': { createClient: async () => ({ auth: { getUser: async () => ({ data: { user: authorized ? { email: 'editor@test' } : null } }) } }), createServiceClient: () => db },
    '@/lib/openai': { getOpenAI: () => ({ chat: { completions: { create: async input => {
      modelCalls.push(input)
      const output = Array.isArray(content) ? content[Math.min(modelCalls.length - 1, content.length - 1)] : content
      if (output instanceof Error) throw output
      return { choices: [{ finish_reason: finish, message: { content: output } }] }
    } } } }) },
    '@/lib/slugify': { slugify: () => 'monthly-briefing', uniqueSlug: async value => value },
    '@/lib/briefingDisplay': load('lib/briefingDisplay.ts'),
    '@/lib/prompts': prompts, '@/lib/monthlyBriefing': monthly, '@/lib/citationStyle': citationStyle,
    '@/lib/embeddings': { embedAndStoreArticle: async () => {} }, '@/lib/revalidate': { revalidateArticleSurfaces: () => {} }
  })
  return { run: body => route.POST(new NextRequest('http://localhost/api/monthly-report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) })), modelCalls }
}

test('report generation uses the wider evidence pool and the saved monthly prompt', async t => {
  const old = process.env.ADMIN_EMAIL; process.env.ADMIN_EMAIL = 'editor@test'
  t.after(() => { if (old === undefined) delete process.env.ADMIN_EMAIL; else process.env.ADMIN_EMAIL = old })
  const db = database({ savedPrompt: 'Custom monthly house style' }), f = generator(db)
  const response = await f.run()
  assert.equal(response.status, 200)
  const data = await response.json()
  assert.equal(data.article_count, 0)
  assert.equal(data.source_count, 1)
  assert.match(f.modelCalls[0].messages[0].content, /^Custom monthly house style/)
  assert.match(f.modelCalls[0].messages[0].content, /SOURCE LINK WORDING/)
  assert.match(f.modelCalls[0].messages[1].content, /source_evidence/)
  assert.ok(f.modelCalls[0].max_tokens >= 4000)
  assert.equal(data.status, 'pending')
  assert.equal(data.draft_id, 'report')
  assert.deepEqual(db.insertTables, ['drafts'])
  assert.equal(db.inserts[0].article_type, 'monthly-summary')
  assert.equal(db.inserts[0].status, 'pending')
  assert.ok(db.inserts[0].monthly_period)
  assert.match(db.inserts[0].title, /Localization Industry Report$/)
  assert.ok(db.inserts[0].content.startsWith(`# ${db.inserts[0].title}\n`))
  assert.deepEqual(JSON.parse(db.inserts[0].extracted_facts).allowed_urls, [source.source_url])
  assert.equal(f.modelCalls.length, 1, 'descriptive links need no extra generation')
})

test('unauthorized, duplicate, empty evidence, truncated and unsupported reports never publish', async t => {
  const old = process.env.ADMIN_EMAIL; process.env.ADMIN_EMAIL = 'editor@test'
  t.after(() => { if (old === undefined) delete process.env.ADMIN_EMAIL; else process.env.ADMIN_EMAIL = old })
  for (const [opts, model, status] of [
    [{}, { authorized: false }, 401], [{ duplicate: [{ id: 'existing' }] }, {}, 409],
    [{ sources: [] }, {}, 404], [{}, { finish: 'length' }, 500],
    [{}, { content: '# Briefing\n[Fake](https://invented.test)' }, 500]
  ]) {
    const db = database(opts), f = generator(db, model), response = await f.run()
    assert.equal(response.status, status)
    assert.equal(db.inserts.length, 0)
    if (status < 500) assert.equal(f.modelCalls.length, 0)
  }
})

test('monthly prompt migration updates the editable setting and preserves its earlier value', async () => {
  const { PGlite } = require('@electric-sql/pglite')
  const db = new PGlite()
  try {
    await db.exec("create table settings(key text primary key,value text); insert into settings values('prompt_monthly','Previous custom prompt'),('other','Keep me');")
    const sql = fs.readFileSync('supabase/migrations/20261120_monthly_industry_briefing_prompt.sql', 'utf8')
    await db.exec(sql); await db.exec(sql)
    const rows = (await db.query('select * from settings')).rows
    assert.equal(rows.find(r => r.key === 'prompt_monthly').value, prompts.DEFAULT_MONTHLY_PROMPT)
    assert.equal(rows.find(r => r.key === 'prompt_monthly_before_industry_briefing').value, 'Previous custom prompt')
    assert.equal(rows.find(r => r.key === 'other').value, 'Keep me')
  } finally { await db.close() }
})


test('an existing pending monthly draft is returned for review even when force is requested', async t => {
  const old = process.env.ADMIN_EMAIL; process.env.ADMIN_EMAIL = 'editor@test'
  t.after(() => { if (old === undefined) delete process.env.ADMIN_EMAIL; else process.env.ADMIN_EMAIL = old })
  const db = database({ draftDuplicate: [{ id: 'pending-monthly' }] }), f = generator(db)
  const response = await f.run({ force: true })
  assert.equal(response.status, 409)
  assert.equal((await response.json()).existing_draft_id, 'pending-monthly')
  assert.equal(f.modelCalls.length, 0)
  assert.equal(db.inserts.length, 0)
})

test('explicit approval preserves report identity, reviewed text and caches without creating a news fact', async () => {
  const draft = { id: 'monthly-draft', title: 'October briefing', content: '# October briefing\n\nOriginal [evidence](https://publisher.test/pricing).',
    slug: '2026-10-briefing', article_type: 'monthly-summary', monthly_period: '2026-10',
    extracted_facts: JSON.stringify({ allowed_urls: [source.source_url] }) }
  const calls = [], cache = []
  const service = { from(table) {
    const q = { select() { return q }, eq() { return q }, limit() { return q },
      single: async () => ({ data: draft, error: null }), maybeSingle: async () => ({ data: null, error: null }) }
    return q
  }, rpc: async (name, args) => { calls.push({ name, args }); return { data: 'published-monthly', error: null } } }
  const fail = () => assert.fail('Monthly publication must not classify or create a Fact Flow item')
  const publisher = load('lib/publish.ts', {
    '@/lib/slugify': { slugify: () => 'edited', uniqueSlug: async value => value }, '@/lib/utils': { extractTeaser: () => 'Excerpt' },
    '@/lib/classify': { classifyArticle: fail }, '@/lib/openai': { getOpenAI: fail },
    '@/lib/embeddings': { embedAndStoreArticle: async () => {} }, '@/lib/factFlow': { ensureArticleFact: fail },
    '@/lib/companyLinks': { getDirectoryEntries: fail, linkifyCompanyMentions: fail },
    '@/lib/revalidate': { revalidateArticleSurfaces: args => cache.push(args) }, '@/lib/sourceName': { draftSourceName: fail },
    '@/lib/eventMatching': {}, '@/lib/monthlyBriefing': monthly
  })
  const edited = 'Edited [evidence](https://publisher.test/pricing).'
  const result = await publisher.approveDraft(service, draft.id, { title: 'Reviewed briefing', content: edited })
  assert.equal(result.status, 'ok')
  assert.equal(calls[0].name, 'publish_editorial_draft')
  assert.equal(calls[0].args.p_article.article_type, 'monthly-summary')
  assert.equal(calls[0].args.p_article.content, edited)
  assert.equal(calls[0].args.p_article.title, 'Reviewed briefing')
  assert.equal(calls[0].args.p_article.slug, draft.slug)
  assert.equal(calls[0].args.p_article.content_type, 'report')
  assert.deepEqual(cache[0], { slug: draft.slug, content_type: 'report' })
})


test('monthly review shows readable source evidence rather than raw storage metadata', () => {
  const React = require('react'), { renderToStaticMarkup } = require('react-dom/server')
  const { MonthlyReportEvidence } = load('components/MonthlyReportEvidence.tsx')
  const html = renderToStaticMarkup(React.createElement(MonthlyReportEvidence, { snapshot: JSON.stringify({ context: {
    source_evidence: [{ title: 'Supplier report', source_url: source.source_url, source_name: 'Publisher', extracted_facts: 'Reported facts', quality: 'snippet', review_reason: 'Check attribution' }]
  }, allowed_urls: [source.source_url] }) }))
  assert.match(html, /Supplier report/)
  assert.match(html, /Reported facts/)
  assert.match(html, /Check attribution/)
  assert.ok(!html.includes('allowed_urls'))
})

test('custom inclusive dates support half months, single days, leap years and Warsaw DST', () => {
  const half = monthly.reportPeriod('2026-11-01', '2026-11-15')
  assert.equal(half.fullMonth, false)
  assert.equal(half.startDate, '2026-10-31T23:00:00.000Z')
  assert.equal(half.endDate, '2026-11-15T23:00:00.000Z')
  assert.equal(half.key, '2026-11-01-to-2026-11-15')
  const spring = monthly.reportPeriod('2026-03-29', '2026-03-29')
  assert.equal(Date.parse(spring.endDate) - Date.parse(spring.startDate), 23 * 3600000)
  const autumn = monthly.reportPeriod('2026-10-25', '2026-10-25')
  assert.equal(Date.parse(autumn.endDate) - Date.parse(autumn.startDate), 25 * 3600000)
  assert.equal(monthly.reportPeriod('2028-02-01', '2028-02-29').fullMonth, true)
  assert.equal(monthly.reportPeriod('2026-10-20', '2026-11-15').period, '2026-10')
  for (const dates of [['2026-02-29', '2026-03-01'], ['2026-11-16', '2026-11-15'], ['2026-11-01', null], ['bad', '2026-11-15']]) {
    assert.throws(() => monthly.reportPeriod(...dates))
  }
})

test('custom range drives every evidence boundary, snapshot, prompt and draft identity', async t => {
  const old = process.env.ADMIN_EMAIL; process.env.ADMIN_EMAIL = 'editor@test'
  t.after(() => { if (old === undefined) delete process.env.ADMIN_EMAIL; else process.env.ADMIN_EMAIL = old })
  const db = database(), f = generator(db)
  const response = await f.run({ start_date: '2026-11-01', end_date: '2026-11-15' })
  assert.equal(response.status, 200)
  const saved = db.inserts[0]
  assert.equal(saved.report_start_date, '2026-11-01')
  assert.equal(saved.report_end_date, '2026-11-15')
  assert.match(saved.slug, /^2026-11-01-to-2026-11-15-/)
  assert.deepEqual(JSON.parse(saved.extracted_facts).context.date_range, {
    start: '2026-11-01', end: '2026-11-15', timezone: 'Europe/Warsaw', end_inclusive: true
  })
  for (const q of db.calls.filter(q => q.filters.some(([k]) => k === 'gte'))) {
    assert.equal(q.filters.find(([k]) => k === 'gte')[2], '2026-10-31T23:00:00.000Z')
    assert.equal(q.filters.find(([k]) => k === 'lt')[2], '2026-11-15T23:00:00.000Z')
  }
  assert.match(f.modelCalls[0].messages[0].content, /not a full calendar month/)
  assert.match(f.modelCalls[0].messages[1].content, /2026-11-01 through 2026-11-15/)
  const pendingQuery = db.calls.find(q => q.table === 'drafts')
  assert.match(pendingQuery.filters.find(([k]) => k === 'or')[1], /report_start_date.eq.2026-11-01,report_end_date.eq.2026-11-15/)
})

test('invalid or incomplete date ranges are rejected before queries or generation', async t => {
  const old = process.env.ADMIN_EMAIL; process.env.ADMIN_EMAIL = 'editor@test'
  t.after(() => { if (old === undefined) delete process.env.ADMIN_EMAIL; else process.env.ADMIN_EMAIL = old })
  for (const body of [{ start_date: '2026-11-01' }, { start_date: '2026-11-15', end_date: '2026-11-01' }, { start_date: '2026-02-30', end_date: '2026-03-15' }]) {
    const db = database(), f = generator(db)
    assert.equal((await f.run(body)).status, 400)
    assert.equal(db.calls.length, 0)
    assert.equal(f.modelCalls.length, 0)
  }
})

test('citation validation recognizes equivalent source URLs and complete Markdown destinations', () => {
  const urls = new Set(['/articles/analysis', 'https://publisher.test/story_(update)?edition=2&lang=en'])
  const content = `# Briefing
[Contents](#findings)
[Analysis](https://www.locreport.com/articles/analysis/?utm_source=report#summary)
[Source](https://publisher.test/story_(update)?lang=en&edition=2&utm_campaign=monthly#results)
[Reference][report]

[report]: <https://publisher.test/story_(update)?edition=2&lang=en>
`
  assert.doesNotThrow(() => monthly.validateBriefing(content, urls))
  assert.doesNotThrow(() => monthly.validateBriefing('# Briefing\n<https://locreport.com/articles/analysis>', urls))
  assert.doesNotThrow(() => monthly.validateBriefing('# Briefing\n[Source](https://publisher.test/story_(update)?edition=2&amp;lang=en)', urls))
  assert.throws(() => monthly.validateBriefing('# Briefing\n[Contents](#findings)', urls), /omitted evidence links/)
  for (const url of ['https://evil.test/articles/analysis', 'https://locreport.com.evil.test/articles/analysis',
    'https://publisher.test/story_(update)?edition=3&lang=en', 'https://publisher.test/invented',
    'javascript:alert(1)', 'https://locreport.com/articles/Analysis']) {
    assert.throws(() => monthly.validateBriefing(`# Briefing\n[Unsupported](<${url}>)`, urls), monthly.BriefingCitationError)
  }
  assert.throws(() => monthly.validateBriefing('# Briefing\n[Unsupported][source]\n\n[source]: https://invented.test', urls), /https:\/\/invented.test/)
})

test('generation repairs unsupported citations once before saving a validated draft', async t => {
  const old = process.env.ADMIN_EMAIL; process.env.ADMIN_EMAIL = 'editor@test'
  t.after(() => { if (old === undefined) delete process.env.ADMIN_EMAIL; else process.env.ADMIN_EMAIL = old })
  const db = database(), f = generator(db, { content: [
    '# Briefing\n[Unsupported](https://invented.test)',
    '# Repaired briefing\nThe [supplier report](https://publisher.test/pricing) raises questions.'
  ] })
  const res = await f.run()
  assert.equal(res.status, 200)
  assert.equal(f.modelCalls.length, 2)
  assert.equal(f.modelCalls[0].messages.length, 2)
  assert.match(f.modelCalls[0].messages[1].content, /Approved citation URLs/)
  assert.equal(f.modelCalls[1].temperature, 0)
  const repair = f.modelCalls[1].messages.at(-1).content
  assert.match(repair, /https:\/\/invented.test/)
  assert.match(repair, /https:\/\/publisher.test\/pricing/)
  assert.match(repair, /Remove any claim/)
  assert.equal(db.inserts.length, 1)
  assert.match(db.inserts[0].content, /^# October 2026 Localization Industry Report/)
  assert.equal(db.inserts[0].status, 'pending')
})

test('failed citation repair never saves a draft and reports the unsupported URL', async t => {
  const old = process.env.ADMIN_EMAIL; process.env.ADMIN_EMAIL = 'editor@test'
  t.after(() => { if (old === undefined) delete process.env.ADMIN_EMAIL; else process.env.ADMIN_EMAIL = old })
  const db = database(), f = generator(db, { content: '# Briefing\n[Unsupported](https://invented.test)' })
  const res = await f.run()
  assert.equal(res.status, 500)
  assert.match((await res.json()).error, /https:\/\/invented.test/)
  assert.equal(f.modelCalls.length, 2)
  assert.equal(db.inserts.length, 0)
})

test('monthly generation improves vague wording within its single repair budget', async t => {
  const old = process.env.ADMIN_EMAIL; process.env.ADMIN_EMAIL = 'editor@test'
  t.after(() => { if (old === undefined) delete process.env.ADMIN_EMAIL; else process.env.ADMIN_EMAIL = old })
  const db = database(), f = generator(db, { content: [
    '# Briefing\nCosts changed ([source](https://publisher.test/pricing)).',
    '# Briefing\nThe [supplier pricing announcement](https://publisher.test/pricing) changes buyer costs.'
  ] })
  assert.equal((await f.run()).status, 200)
  assert.equal(f.modelCalls.length, 2)
  assert.match(f.modelCalls[1].messages.at(-1).content, /Improve only the source-link wording/)
  assert.match(db.inserts[0].content, /\[supplier pricing announcement\]/)
  assert.deepEqual(citationStyle.unclearCitations(db.inserts[0].content), [])
  assert.deepEqual(db.insertTables, ['drafts'])
})

test('monthly wording problems remain editable when a cosmetic retry fails or changes sources', async t => {
  const old = process.env.ADMIN_EMAIL; process.env.ADMIN_EMAIL = 'editor@test'
  t.after(() => { if (old === undefined) delete process.env.ADMIN_EMAIL; else process.env.ADMIN_EMAIL = old })
  const first = '# Briefing\nCosts changed ([source](https://publisher.test/pricing)).'
  for (const retry of [first, new Error('Model unavailable'), '# Briefing\n[report](https://invented.test)',
    '# Briefing\nNo links.', 'No title. [report](https://publisher.test/pricing)']) {
    const db = database(), f = generator(db, { content: [first, retry] })
    assert.equal((await f.run()).status, 200)
    assert.equal(f.modelCalls.length, 2)
    assert.equal(db.inserts[0].content.split('\n').slice(1).join('\n'), first.split('\n').slice(1).join('\n'))
    assert.equal(db.inserts[0].status, 'pending')
  }
})

test('unsupported and vague citations get one coherent repair without preserving unsupported URLs', async t => {
  const old = process.env.ADMIN_EMAIL; process.env.ADMIN_EMAIL = 'editor@test'
  t.after(() => { if (old === undefined) delete process.env.ADMIN_EMAIL; else process.env.ADMIN_EMAIL = old })
  const db = database(), f = generator(db, { content: [
    '# Briefing\n[source](https://invented.test)', '# Briefing\n[source](https://publisher.test/pricing)'
  ] })
  assert.equal((await f.run()).status, 200)
  assert.equal(f.modelCalls.length, 2, 'URL repair and style share one extra call')
  const repair = f.modelCalls[1].messages.at(-1).content
  assert.match(repair, /Unsupported URLs/)
  assert.match(repair, /SOURCE LINK WORDING/)
  assert.ok(!repair.includes('Preserve the title, factual claims, numbers and all link destinations'))
  assert.equal(citationStyle.unclearCitations(db.inserts[0].content).length, 1, 'remaining style issue is editable')
})
