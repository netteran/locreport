const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
function load(file, dependencies = {}) {
  const m = { exports: {} }
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX }
  }).outputText
  new Function('exports', 'require', 'module', code)(m.exports, id => dependencies[id] || require(id), m)
  return m.exports
}
const schema = load('lib/researchSchema.ts')
const { loadAdminFacts } = load('lib/adminFacts.ts', { '@/lib/researchSchema': schema })
function client(results) {
  const calls = []
  return { calls, from(table) {
    const call = { table }
    calls.push(call)
    const q = {
      select(value) { call.select = value; return q },
      order() { return q }, limit() { return q },
      in(key, values) { call[key] = values; return q },
      then(resolve, reject) { return Promise.resolve(results[table]).then(resolve, reject) }
    }
    return q
  } }
}
const facts = [
  { id: 'pending', content: 'Funding announcement', status: 'pending', article_id: null },
  { id: 'published', content: 'Published news', status: 'published', article_id: 'article' }
]
test('admin loads pending and published facts without an inferred article relationship', async () => {
  const db = client({ facts: { data: facts, error: null }, articles: { data: [{ id: 'article', slug: 'analysis' }], error: null } })
  const rows = await loadAdminFacts(db)
  assert.equal(rows.length, 2)
  assert.equal(rows[0].status, 'pending')
  assert.equal(rows[0].articles, null)
  assert.deepEqual(rows[1].articles, [{ slug: 'analysis' }])
  assert.ok(!db.calls[0].select.includes('('), 'must not depend on inferred foreign keys')
  assert.deepEqual(db.calls[1].id, ['article'])
})
for (const error of [
  { code: '42703', message: 'column facts.status does not exist' },
  { code: 'PGRST204', message: "Could not find the 'review_reason' column of 'facts' in the schema cache" }
]) {
  test(`missing publication schema explains which migration to apply: ${error.code}`, async () => {
    await assert.rejects(loadAdminFacts(client({ facts: { data: null, error } })), /20261113_research_publications.sql/)
  })
}
test('database and permission errors cannot become an empty admin list', async () => {
  await assert.rejects(loadAdminFacts(client({ facts: { data: null, error: { code: '42501', message: 'permission denied for table facts' } } })), /Could not load Fact Flow: permission denied/)
})
test('article-link errors remain visible instead of discarding facts', async () => {
  await assert.rejects(loadAdminFacts(client({ facts: { data: facts, error: null }, articles: { data: null, error: { message: 'connection failed' } } })), /Fact Flow article links: connection failed/)
})
test('a genuinely empty facts table returns an empty list without querying articles', async () => {
  const db = client({ facts: { data: [], error: null } })
  assert.deepEqual(await loadAdminFacts(db), [])
  assert.equal(db.calls.length, 1)
})
test('admin page displays loading failure instead of the empty-list component', async () => {
  const { default: Page } = load('app/(public)/admin/fact-flow/page.tsx', {
    '@/lib/supabase/server': { createServiceClient: () => ({}) },
    '@/lib/adminFacts': { loadAdminFacts: async () => { throw new Error('Could not load Fact Flow: database unavailable') } },
    './FactFlowAdmin': { FactFlowAdmin: () => assert.fail('must not render an empty list on error') }
  })
  const html = renderToStaticMarkup(await Page())
  assert.match(html, /role="alert"/)
  assert.match(html, /database unavailable/)
  assert.ok(!html.includes('No facts yet'))
})
test('admin starts with all statuses visible and marks the active filter', () => {
  const { FactFlowAdmin } = load('app/(public)/admin/fact-flow/FactFlowAdmin.tsx')
  const html = renderToStaticMarkup(React.createElement(FactFlowAdmin, { initialFacts: facts }))
  assert.match(html, /Funding announcement/)
  assert.match(html, /Published news/)
  assert.match(html, /aria-pressed="true"[^>]*>all<\/button>/)
})
