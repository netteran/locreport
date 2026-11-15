const { test } = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const fs = require('node:fs')
const ts = require('typescript')
const { createClient } = require('@supabase/supabase-js')

const editorial = { exports: {} }
new Function('exports', 'require', 'module', ts.transpileModule(
  fs.readFileSync('lib/editorialPitches.ts', 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }
).outputText)(editorial.exports, require, editorial)
const m = { exports: {} }
const dependencies = {
  '@/lib/editorialPitches': editorial.exports,
  '@/lib/openai': { getOpenAI: () => assert.fail('A locked batch must not call a model') },
  '@/lib/embeddings': {},
  '@/lib/eventMatching': {},
  '@/lib/revalidate': {}
}
new Function('exports', 'require', 'module', ts.transpileModule(
  fs.readFileSync('lib/research.ts', 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }
).outputText)(m.exports, id => dependencies[id] || require(id), m)

test('scoped manual matching stops on an occupied event lock without pretending to process candidates', async (t) => {
  const requests = []
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    requests.push(url)
    res.setHeader('Content-Type', 'application/json')
    if (url.pathname === '/rest/v1/source_candidates') {
      return res.end(JSON.stringify([{ id: 'first' }, { id: 'second' }]))
    }
    if (url.pathname === '/rest/v1/rpc/claim_research_lock') return res.end('false')
    res.statusCode = 500
    res.end(JSON.stringify({ message: 'Unexpected database operation' }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const client = createClient(`http://127.0.0.1:${server.address().port}`, 'fixture-service', {
    auth: { persistSession: false, autoRefreshToken: false }
  })
  const result = await m.exports.processPendingCandidates(client, 6, ['selected-source'])
  assert.deepEqual(result, { processed: 0, errors: [] })
  assert.equal(requests.length, 2, 'must not repeatedly claim the lock for every candidate')
  assert.equal(requests[0].searchParams.get('source_feed_id'), 'in.(selected-source)')
  assert.equal(requests[0].searchParams.get('processing_status'), 'in.(pending,error)')
  assert.equal(requests[1].pathname, '/rest/v1/rpc/claim_research_lock')
})

test('JSON requests always instruct JSON output, including article suggestions', async () => {
  let request
  const fixture = { exports: {} }
  new Function('exports', 'require', 'module', ts.transpileModule(
    fs.readFileSync('lib/research.ts', 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }
  ).outputText)(fixture.exports, id => id === '@/lib/openai' ? {
    getOpenAI: () => ({ chat: { completions: { create: async input => {
      request = input
      return { choices: [{ finish_reason: 'stop', message: { content: '{"groups":[]}' } }] }
    } } } })
  } : dependencies[id] || require(id), fixture)
  assert.deepEqual(await fixture.exports.jsonModel('Suggest coherent articles.', {}), { groups: [] })
  assert.equal(request.response_format.type, 'json_object')
  assert.match(request.messages[0].content, /JSON/)
})

test('event extraction requests enforce the same action and stage enums as validation', async () => {
  const events = { exports: {} }
  new Function('exports', 'require', 'module', ts.transpileModule(
    fs.readFileSync('lib/eventMatching.ts', 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }
  ).outputText)(events.exports, require, events)
  const event = {
    subject: 'Example', action: 'product_launch', object: 'Translator', stage: 'launched',
    event_date: null, headline: 'Example launches Translator.', newsworthy: true,
    entities: ['Example'], topics: ['translation']
  }
  let request
  const fixture = { exports: {} }
  new Function('exports', 'require', 'module', ts.transpileModule(
    fs.readFileSync('lib/research.ts', 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }
  ).outputText)(fixture.exports, id => id === '@/lib/openai' ? {
    getOpenAI: () => ({ chat: { completions: { create: async input => {
      request = input
      return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(event) } }] }
    } } } })
  } : id === '@/lib/eventMatching' ? events.exports : dependencies[id] || require(id), fixture)
  assert.deepEqual(await fixture.exports.descriptorForReview({
    title: 'Launch', extracted_facts: 'Source evidence', source_published_at: null
  }), event)
  assert.equal(request.response_format.type, 'json_schema')
  const schema = request.response_format.json_schema
  assert.equal(schema.strict, true)
  assert.equal(schema.schema.additionalProperties, false)
  for (const action of schema.schema.properties.action.enum) {
    for (const stage of schema.schema.properties.stage.enum) {
      assert.doesNotThrow(() => events.exports.parseDescriptor({ ...event, action, stage }))
    }
  }
  assert.deepEqual(schema.schema.required.sort(), Object.keys(schema.schema.properties).sort())
})

test('article suggestions retain old and uncertain evidence without requiring an event match', async () => {
  const rows = ['old', 'uncertain'].map(id => ({
    id, title: id, source_name: 'Publisher', source_published_at: '2025-01-01',
    event_id: null, extracted_facts: 'Complementary source evidence', topics: ['localization'], entities: []
  }))
  let request
  const writes = []
  const filters = []
  const service = {
    from(table) {
      const q = {
        select() { return q },
        eq(key, value) { filters.push([table, key, value]); return q },
        gte() { assert.fail('Waiting evidence must not expire from suggestions') },
        order() { return q }, limit() { return q }, lte() { return q },
        maybeSingle: async () => ({ data: null, error: null }),
        upsert: async data => { writes.push([table, data]); return { data: null, error: null } },
        then(resolve, reject) { return Promise.resolve({ data: table === 'source_candidates' ? rows : [], error: null }).then(resolve, reject) }
      }
      return q
    },
    rpc: async () => ({ data: [], error: null })
  }
  const fixture = { exports: {} }
  new Function('exports', 'require', 'module', ts.transpileModule(
    fs.readFileSync('lib/research.ts', 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }
  ).outputText)(fixture.exports, id => id === '@/lib/openai' ? {
    getOpenAI: () => ({ chat: { completions: { create: async input => {
      request = input
      return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ groups: [{
        title: 'A related analysis', question: 'What changed?', rationale: 'Complementary evidence', candidate_ids: ['old', 'uncertain'],
        stage: 'ready', why_now: 'New operating choices', audience: 'Buyers deciding who to hire',
        originality: 'Tests operational consequences', counterargument: 'Costs may not increase', missing_evidence: [],
        source_contributions: [{ candidate_id: 'old', contribution: 'Baseline' }, { candidate_id: 'uncertain', contribution: 'Recent perspective' }],
        scores: { reader_value: 4, originality: 4, evidence: 4 }
      }] }) } }] }
    } } } })
  } : dependencies[id] || require(id), fixture)
  await fixture.exports.refreshStoryGroups(service)
  assert.deepEqual(JSON.parse(request.messages[1].content).sources.map(s => s.id), ['old', 'uncertain'])
  assert.deepEqual(writes.find(([table]) => table === 'story_groups')[1].candidate_ids, ['old', 'uncertain'])
  assert.deepEqual(filters.filter(([table]) => table === 'source_candidates'), [
    ['source_candidates', 'status', 'available'], ['source_candidates', 'processing_status', 'ready']
  ])
})
