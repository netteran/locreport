const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
function load(file, dependencies = {}) {
  const m = { exports: {} }
  new Function('exports', 'require', 'module', ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText)(m.exports, id => dependencies[id] || require(id), m)
  return m.exports
}
const editorial = load('lib/editorialPitches.ts')
const base = {
  title: 'Who pays for faster translation?', question: 'Could cheaper translation raise operating costs?',
  rationale: 'A buyer decision', candidate_ids: ['source-1'], stage: 'ready', why_now: 'A new pricing model',
  audience: 'Buyers deciding budgets', originality: 'Compare total cost rather than unit price',
  counterargument: 'Workflow automation could reduce total cost', missing_evidence: [],
  source_contributions: [{ candidate_id: 'source-1', contribution: 'Documents pricing changes' }],
  scores: { reader_value: 5, originality: 4, evidence: 4 }
}
const normalize = value => editorial.normalizePitch(value, new Set(['source-1', 'source-2']))
test('missing evidence or a weak premise prevents a ready-to-develop classification', () => {
  assert.equal(normalize(base).pitch.stage, 'ready')
  const lead = normalize({ ...base, missing_evidence: ['Interview a buyer about integration costs'] })
  assert.equal(lead.pitch.stage, 'investigate')
  assert.deepEqual(lead.pitch.missing_evidence, ['Interview a buyer about integration costs'])
  const weak = normalize({ ...base, scores: { ...base.scores, evidence: 2 } })
  assert.equal(weak.pitch.stage, 'investigate')
  assert.ok(weak.pitch.missing_evidence.length)
  assert.equal(normalize({ ...base, stage: 'investigate' }).pitch.stage, 'investigate')
})
test('pitches require known sources, distinct contributions and complete editorial reasoning', () => {
  for (const patch of [
    { candidate_ids: [] }, { candidate_ids: ['invented'] }, { candidate_ids: Array(9).fill(0).map((_, i) => `source-${i}`) },
    { source_contributions: [] }, { source_contributions: [{ candidate_id: 'invented', contribution: 'Made up' }] },
    { missing_evidence: undefined }, { audience: '' }, { originality: '' }, { counterargument: '' }, { why_now: '' }, { stage: 'publish' }
  ]) assert.equal(normalize({ ...base, ...patch }), null)
  assert.equal(normalize(null), null)
  assert.equal(normalize({ ...base, scores: { reader_value: Infinity, originality: -4, evidence: 50 } }).pitch.score, 25)
})
function fixture({ results, history = [], coverage = [], prior = null, schemaError = null, existing = null } = {}) {
  const requests = [], writes = [], selects = []
  const rows = [{ id: 'source-1', title: 'Pricing announcement', extracted_facts: 'Prices changed.', topics: [], entities: [], event_id: null }]
  const service = {
    from(table) {
      const q = {
        select(columns) { selects.push([table, columns]); return q }, eq() { return q }, order() { return q }, limit() { return q }, lte() { return q },
        maybeSingle: async () => ({ data: table === 'story_groups' ? existing : prior ? { value: prior } : null, error: null }),
        update(data) { writes.push({ table, data, update: true }); return q },
        upsert: async (data, options) => { writes.push({ table, data, options }); return { data: null, error: null } },
        then(resolve, reject) { return Promise.resolve({
          data: table === 'source_candidates' ? rows : table === 'articles' ? coverage : history,
          error: table === 'story_groups' ? schemaError : null
        }).then(resolve, reject) }
      }
      return q
    }, rpc: async () => ({ data: [], error: null })
  }
  const research = load('lib/research.ts', {
    '@/lib/editorialPitches': editorial, '@/lib/embeddings': {}, '@/lib/eventMatching': {}, '@/lib/revalidate': {},
    '@/lib/openai': { getOpenAI: () => ({ chat: { completions: { create: async input => {
      requests.push(input)
      const result = results?.[requests.length - 1] ?? { groups: [base] }
      return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(result) } }] }
    } } } }) }
  })
  return { run: () => research.refreshStoryGroups(service), requests, writes, selects }
}
test('draft then critique receive coverage and pitch memory; only critiqued ideas are saved', async () => {
  const f = fixture({
    results: [{ groups: [{ ...base, title: 'Speculative draft' }] }, { groups: [{ ...base, missing_evidence: ['Check buyer costs'] }] }],
    coverage: [{ title: 'Our earlier pricing article', excerpt: 'Unit prices', published_at: '2026-11-01' }],
    history: [{ title: 'Old pitch', question: 'Old question', dismissed: true }]
  })
  await f.run()
  assert.equal(f.requests.length, 2)
  assert.equal(f.requests[0].temperature, 0.7)
  assert.equal(f.requests[1].temperature, 0)
  const input = JSON.parse(f.requests[1].messages[1].content)
  assert.equal(input.recent_coverage[0].title, 'Our earlier pricing article')
  assert.equal(input.previous_pitches[0].dismissed, true)
  assert.equal(input.proposed_pitches[0].title, 'Speculative draft')
  const saved = f.writes.find(w => w.table === 'story_groups')
  assert.equal(saved.data.title, base.title)
  assert.equal(saved.data.pitch.stage, 'investigate')
  assert.equal(saved.options.ignoreDuplicates, true, 'refresh must not revive dismissed identical pitches')
  assert.ok(f.writes.some(w => w.table === 'settings'))
})
test('different angles can use the same evidence, while cache also tracks coverage changes', async () => {
  const f = fixture({ results: [{ groups: [base] }, { groups: [base, { ...base, question: 'Who captures the savings?' }] }] })
  await f.run()
  const saved = f.writes.filter(w => w.table === 'story_groups')
  assert.equal(saved.length, 2)
  assert.notEqual(saved[0].data.fingerprint, saved[1].data.fingerprint)
  const signature = f.writes.find(w => w.table === 'settings').data.value
  const cached = fixture({ prior: signature })
  await cached.run()
  assert.equal(cached.requests.length, 0)
  const changed = fixture({ prior: signature, coverage: [{ title: 'Newly published analysis' }] })
  await changed.run()
  assert.equal(changed.requests.length, 2)
})
test('missing schema, model errors and invented evidence do not cache a successful refresh', async () => {
  const missing = fixture({ schemaError: { code: '42703', message: 'column story_groups.pitch does not exist' } })
  await assert.rejects(missing.run(), /20261118_editorial_pitches.sql/)
  assert.equal(missing.requests.length, 0)
  for (const results of [[{}], [{ groups: [base] }, {}, {}], [{ groups: [base] }, { groups: [{ ...base, candidate_ids: ['invented'] }] }, { groups: [{ ...base, candidate_ids: ['invented'] }] }]]) {
    const f = fixture({ results })
    await assert.rejects(f.run(), /pitch|critique/)
    assert.equal(f.writes.length, 0)
  }
})


test('evidence changes can advance an existing lead without reviving a dismissed idea', async () => {
  const active = fixture({ existing: { id: 'lead', dismissed: false } })
  await active.run()
  const saved = active.writes.find(w => w.table === 'story_groups')
  assert.equal(saved.update, true)
  assert.equal(saved.data.pitch.stage, 'ready')
  const dismissed = fixture({ existing: { id: 'dismissed', dismissed: true } })
  await dismissed.run()
  assert.equal(dismissed.writes.filter(w => w.table === 'story_groups').length, 0)
})


test('both editorial passes constrain structure and source IDs, with one bounded repair', async () => {
  const f = fixture({ results: [{ groups: [base] }, { groups: [{ ...base, source_contributions: [] }] }, { groups: [base] }] })
  await f.run()
  assert.equal(f.requests.length, 3)
  for (const request of f.requests) {
    assert.equal(request.response_format.type, 'json_schema')
    assert.equal(request.response_format.json_schema.strict, true)
    const item = request.response_format.json_schema.schema.properties.groups.items
    assert.deepEqual(item.properties.candidate_ids.items.enum, ['source-1'])
    assert.ok(item.required.includes('source_contributions'))
    assert.ok(item.required.includes('counterargument'))
  }
  assert.match(JSON.parse(f.requests[2].messages[1].content).correction, /exactly one/)
  assert.equal(f.writes.filter(w => w.table === 'story_groups').length, 1)
})

test('a critique can return no supported ideas without failing Fact Flow or inventing pitches', async () => {
  const f = fixture({ results: [{ groups: [base] }, { groups: [] }] })
  await f.run()
  assert.equal(f.requests.length, 2)
  assert.equal(f.writes.filter(w => w.table === 'story_groups').length, 0)
  assert.ok(f.writes.some(w => w.table === 'settings'))
})
