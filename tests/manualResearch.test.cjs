const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const m = { exports: {} }
new Function('exports', 'module', ts.transpileModule(
  fs.readFileSync('lib/manualResearch.ts', 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }
).outputText)(m.exports, m)
const { runResearchPipeline } = m.exports

function responses(t, queue) {
  const calls = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) })
    assert.equal(options.method, 'POST')
    assert.equal(url, '/api/research/process', 'research must never call article generation or publication')
    assert.ok(queue.length, 'unexpected extra request')
    const response = queue.shift()
    return typeof response === 'function' ? response() : Response.json(response)
  })
  return calls
}

test('manual processing drains matching batches before refreshing article suggestions', async (t) => {
  const calls = responses(t, [
    { action: 'processed', processed: 6, errors: [] },
    { action: 'idle', processed: 2, errors: [] },
    { ok: true }
  ])
  const progress = []
  const result = await runResearchPipeline({ onProgress: (message) => progress.push(message) })
  assert.deepEqual(result, { processed: 8, processingComplete: true, suggestionsRefreshed: true, errors: [] })
  assert.deepEqual(calls.map(c => c.body), [{}, {}, { stage: 'groups' }])
  assert.match(progress.at(-1), /suggestions/)
})

test('individual source and batch runs keep fact processing scoped; suggestions combine across sources', async (t) => {
  const calls = responses(t, [
    { action: 'idle', processed: 1, errors: [] }, { ok: true }
  ])
  const sourceIds = ['10000000-0000-4000-8000-000000000001']
  await runResearchPipeline({ sourceIds })
  assert.deepEqual(calls.map(c => c.body), [{ source_ids: sourceIds }, { stage: 'groups' }])
})

test('saved work and suggestions are processed even when no new candidates were collected', async (t) => {
  const calls = responses(t, [{ action: 'idle', processed: 0, errors: [] }, { ok: true }])
  const result = await runResearchPipeline()
  assert.equal(calls.length, 2)
  assert.equal(result.processingComplete, true)
  assert.equal(result.suggestionsRefreshed, true)
})

test('candidate errors remain visible while successful evidence still reaches suggestions', async (t) => {
  responses(t, [{ action: 'idle', processed: 2, errors: ['candidate requires retry'] }, { ok: true }])
  const result = await runResearchPipeline()
  assert.deepEqual(result.errors, ['candidate requires retry'])
  assert.equal(result.suggestionsRefreshed, true)
})

test('missing migration or lost authorization stops processing with the server explanation', async (t) => {
  const calls = responses(t, [() => Response.json(
    { error: 'Apply migration 20261113_research_publications.sql' }, { status: 503 }
  )])
  const result = await runResearchPipeline()
  assert.equal(result.processingComplete, false)
  assert.equal(result.suggestionsRefreshed, false)
  assert.match(result.errors[0], /20261113_research_publications.sql/)
  assert.equal(calls.length, 1)
})

test('suggestion failure preserves completed fact processing and reports the failed stage', async (t) => {
  responses(t, [
    { action: 'idle', processed: 3, errors: [] },
    () => Response.json({ error: 'Model rate limit' }, { status: 429 })
  ])
  const result = await runResearchPipeline()
  assert.equal(result.processingComplete, true)
  assert.equal(result.suggestionsRefreshed, false)
  assert.match(result.errors[0], /Article suggestions: Model rate limit/)
})

test('event lock contention stops polling and leaves an explicit resume message', async (t) => {
  const calls = responses(t, [{ action: 'processed', processed: 0, errors: [] }, { ok: true }])
  const result = await runResearchPipeline()
  assert.equal(result.processingComplete, false)
  assert.match(result.errors[0], /Another run/)
  assert.equal(calls.length, 2)
})

test('a large backlog is bounded, refreshes ready suggestions and is never reported as complete', async (t) => {
  const calls = responses(t, [
    ...Array.from({ length: 20 }, () => ({ action: 'processed', processed: 6, errors: [] })),
    { ok: true }
  ])
  const result = await runResearchPipeline()
  assert.equal(result.processed, 120)
  assert.equal(result.processingComplete, false)
  assert.equal(result.suggestionsRefreshed, true)
  assert.match(result.errors[0], /More sources remain/)
  assert.equal(calls.length, 21)
})

test('platform HTML timeouts remain readable and recoverable', async (t) => {
  responses(t, [() => new Response('<html>Gateway timeout</html>', { status: 504 })])
  const result = await runResearchPipeline()
  assert.match(result.errors[0], /timed out.*Saved sources/)
  assert.equal(result.processingComplete, false)
})
