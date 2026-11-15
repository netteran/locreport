const { test } = require('node:test')
const assert = require('node:assert/strict')
const ts = require('typescript')
const fs = require('node:fs')
const mod = { exports: {} }
new Function('exports', 'require', 'module', ts.transpileModule(fs.readFileSync('lib/candidateFilters.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS }
}).outputText)(mod.exports, require, mod)
const { filterCandidates, publisherName } = mod.exports
const defaults = { status: 'available', query: '', publisher: '', dateFrom: '', dateTo: '', sort: 'published-desc' }
const candidates = [
  { id: 'early', title: 'First report', source_name: ' Publisher A ', source_feed_id: 'shared-feed', source_published_at: '2026-11-01T00:00:00Z', created_at: '2026-11-15', status: 'available', topics: ['AI'], entities: [] },
  { id: 'late', title: 'Last report', source_name: 'Publisher B', source_feed_id: 'shared-feed', source_published_at: '2026-11-14T23:59:59Z', created_at: '2026-11-14', status: 'available', topics: [], entities: [] },
  { id: 'unknown', title: 'Undated report', source_name: null, source_published_at: null, created_at: '2026-11-13', status: 'available', topics: [], entities: [] },
  { id: 'used', title: 'Used report', source_name: 'Publisher A', source_published_at: '2026-11-10T12:00:00Z', created_at: '2026-11-12', status: 'used', topics: ['AI'], entities: [] }
]
const ids = filters => filterCandidates(candidates, { ...defaults, ...filters }).map(c => c.id)
test('filters by original publisher independently of shared feed and combines search/status', () => {
  assert.deepEqual(ids({ publisher: 'Publisher A', query: ' AI ' }), ['early'])
  assert.deepEqual(ids({ publisher: 'Publisher A', status: 'all' }), ['used', 'early'])
  assert.equal(publisherName(candidates[2]), 'Unknown publisher')
  assert.deepEqual(ids({ publisher: 'Unknown publisher' }), ['unknown'])
})
test('publication boundaries include entire end day and exclude undated candidates', () => {
  assert.deepEqual(ids({ dateFrom: '2026-11-01', dateTo: '2026-11-14' }), ['late', 'early'])
  assert.deepEqual(ids({ dateFrom: '2026-11-14' }), ['late'])
  assert.deepEqual(ids({ dateTo: '2026-11-01' }), ['early'])
  assert.deepEqual(ids({ dateFrom: '2026-11-15', dateTo: '2026-11-01' }), [])
})
test('sorts by publication or collection and leaves undated publications last', () => {
  assert.deepEqual(ids({}), ['late', 'early', 'unknown'])
  assert.deepEqual(ids({ sort: 'published-asc' }), ['early', 'late', 'unknown'])
  assert.deepEqual(ids({ sort: 'collected-desc' }), ['early', 'late', 'unknown'])
  assert.deepEqual(candidates.map(c => c.id), ['early', 'late', 'unknown', 'used'])
})
