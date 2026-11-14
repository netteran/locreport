const { test } = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const fs = require('node:fs')
const ts = require('typescript')
const { createClient } = require('@supabase/supabase-js')

const m = { exports: {} }
const dependencies = {
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
