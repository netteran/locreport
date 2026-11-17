const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const { createClient } = require('@supabase/supabase-js')

const m = { exports: {} }
new Function('exports', 'require', 'module', ts.transpileModule(fs.readFileSync('lib/briefingCoverage.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText)(m.exports, require, m)
const { withOptionalBriefingCoverage } = m.exports

function service(respond) {
  const requests = []
  const client = createClient('https://fixture.example.test', 'fixture-service', {
    auth: { persistSession: false },
    global: { fetch: async input => {
      const url = new URL(input)
      requests.push(url)
      return respond(url, requests.length)
    } }
  })
  return { client, requests }
}

test('modern deployments fetch coverage metadata once through the Supabase query', async () => {
  const rows = [{ id: 'briefing', report_start_date: '2026-10-01', report_end_date: '2026-10-31' }]
  const { client, requests } = service(() => new Response(JSON.stringify(rows), { headers: { 'Content-Type': 'application/json' } }))
  const result = await withOptionalBriefingCoverage(columns => client.from('articles').select(`id${columns}`).eq('article_type', 'monthly-summary'))
  assert.equal(result.error, null)
  assert.deepEqual(result.data, rows)
  assert.equal(requests.length, 1)
  assert.equal(requests[0].searchParams.get('select'), 'id,monthly_period,report_start_date,report_end_date')
  assert.equal(requests[0].searchParams.get('article_type'), 'eq.monthly-summary')
})

test('older schemas retry base columns while preserving filters and returning existing records', async () => {
  for (const code of ['42703', 'PGRST204']) {
    const rows = [{ id: 'legacy-briefing' }]
    const { client, requests } = service((_url, count) => count === 1
      ? new Response(JSON.stringify({ code, message: "Could not find the 'report_start_date' column of 'articles'" }), { status: 400, headers: { 'Content-Type': 'application/json' } })
      : new Response(JSON.stringify(rows), { headers: { 'Content-Type': 'application/json' } }))
    const result = await withOptionalBriefingCoverage(columns => client.from('articles').select(`id${columns}`).eq('article_type', 'monthly-summary'))
    assert.equal(result.error, null)
    assert.deepEqual(result.data, rows)
    assert.equal(requests.length, 2)
    assert.equal(requests[1].searchParams.get('select'), 'id')
    assert.equal(requests[1].searchParams.get('article_type'), 'eq.monthly-summary')
  }
})

test('permission failures and unrelated missing fields retain the original error without retry', async () => {
  for (const error of [
    { code: '42501', message: 'permission denied for monthly_period' },
    { code: '42703', message: 'column articles.title does not exist' },
    { code: 'PGRST204', message: "Could not find the 'image_url' column" },
    { code: '42703', message: 'column articles.monthly_period_backup does not exist' },
    { code: 'PGRST204' },
  ]) {
    let calls = 0
    const result = { data: null, error }
    assert.equal(await withOptionalBriefingCoverage(async () => { calls++; return result }), result)
    assert.equal(calls, 1)
  }
})

test('a failed compatibility retry remains a failure and transport exceptions propagate', async () => {
  let calls = 0
  const failure = { data: null, error: { code: '42501', message: 'permission denied' } }
  const result = await withOptionalBriefingCoverage(async () => ++calls === 1
    ? { data: null, error: { code: '42703', message: 'column articles.monthly_period does not exist' } }
    : failure)
  assert.equal(result, failure)
  assert.equal(calls, 2)

  calls = 0
  await assert.rejects(withOptionalBriefingCoverage(async () => { calls++; throw new Error('Connection unavailable') }), /Connection unavailable/)
  assert.equal(calls, 1)
})
