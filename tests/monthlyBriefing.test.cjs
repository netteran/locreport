const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const { NextRequest } = require('next/server')
function load(file, dependencies = {}) {
  const m = { exports: {} }
  new Function('exports', 'require', 'module', ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX }
  }).outputText)(m.exports, id => dependencies[id] || require(id), m)
  return m.exports
}
const monthly = load('lib/monthlyBriefing.ts')
const prompts = load('lib/prompts.ts')
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
  assert.equal(evidence.context.previous_briefing.url, '/articles/earlier')
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
      modelCalls.push(input); return { choices: [{ finish_reason: finish, message: { content } }] }
    } } } }) },
    '@/lib/slugify': { slugify: () => 'monthly-briefing', uniqueSlug: async value => value },
    '@/lib/prompts': prompts, '@/lib/monthlyBriefing': monthly,
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
  assert.equal(f.modelCalls[0].messages[0].content, 'Custom monthly house style')
  assert.match(f.modelCalls[0].messages[1].content, /source_evidence/)
  assert.ok(f.modelCalls[0].max_tokens >= 4000)
  assert.equal(data.status, 'pending')
  assert.equal(data.draft_id, 'report')
  assert.deepEqual(db.insertTables, ['drafts'])
  assert.equal(db.inserts[0].article_type, 'monthly-summary')
  assert.equal(db.inserts[0].status, 'pending')
  assert.ok(db.inserts[0].monthly_period)
  assert.deepEqual(JSON.parse(db.inserts[0].extracted_facts).allowed_urls, [source.source_url])
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
  assert.equal(cache[0].monthlyReport, true)
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
