const { test } = require('node:test')
const assert = require('node:assert/strict')
const ts = require('typescript')
const fs = require('node:fs')
const source = fs.readFileSync('lib/seenUrls.ts', 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
const compiledModule = { exports: {} }
new Function('exports', 'require', 'module', compiled)(compiledModule.exports, require, compiledModule)
const { loadSeenUrls, rememberSeenUrl } = compiledModule.exports

function database(tables, failTable, failAfter = -1) {
  return { from(table) {
    let cursor
    let key
    const query = {
      select() { return this }, not() { return this },
      order(value) { key = value; return this }, limit() { return this },
      gt(_, value) { cursor = value; return this },
      then(resolve, reject) {
        const rows = (tables[table] || []).filter(row => cursor === undefined || row[key] > cursor)
        // Simulate a server row cap smaller than the requested page size.
        const error = table === failTable && (failAfter < 0 || cursor !== undefined)
          ? { message: 'database unavailable' } : null
        return Promise.resolve({ data: error ? null : rows.slice(0, 2), error }).then(resolve, reject)
      },
    }
    return query
  } }
}

test('loads seen URLs beyond server row cap and all draft/article pages', async () => {
  const seen = await loadSeenUrls(database({
    seen_urls: ['a','b','c','d','e'].map(url => ({ url })),
    drafts: ['f','g','h'].map((source_url, id) => ({ id: String(id), source_url })),
    articles: ['i','j','k'].map((source_url, id) => ({ id: String(id), source_url })),
  }))
  assert.deepEqual([...seen], ['a','b','c','d','e','f','g','h','i','j','k'])
})

for (const table of ['seen_urls', 'drafts', 'articles']) {
  test(`fails closed when ${table} cannot be read`, async () => {
    await assert.rejects(loadSeenUrls(database({}, table)), new RegExp(table))
  })
}

test('fails closed when a later history page fails', async () => {
  await assert.rejects(loadSeenUrls(database({ seen_urls: [{url:'a'}, {url:'b'}, {url:'c'}] }, 'seen_urls', 1)), /seen_urls/)
})

test('persists URLs idempotently and reports write failures', async () => {
  const calls = []
  const db = { from(table) { return { async upsert(row, options) {
    calls.push({ table, row, options })
    return { error: null }
  } } } }
  await rememberSeenUrl(db, 'https://example.com/story')
  assert.deepEqual(calls, [{ table: 'seen_urls', row: { url: 'https://example.com/story' }, options: { onConflict: 'url', ignoreDuplicates: true } }])
  await assert.rejects(rememberSeenUrl({ from() { return { upsert: async () => ({ error: { message: 'write denied' } }) } } }, 'url'), /write denied/)
})
