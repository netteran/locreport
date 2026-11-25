const { test } = require('node:test')
const assert = require('node:assert/strict')
const { load } = require('./fixtures/typescript.cjs')

const { noindexArticleIds, isArticleNoindex } = load('lib/articleIndexing.ts')

// Minimal stand-in for the supabase-js query builder used by lib/articleIndexing.ts.
function client(rows, error = null) {
  const calls = []
  const builder = (result) => {
    const q = {
      select: () => q, eq: () => q, order: () => q,
      range: (from, to) => { calls.push([from, to]); return Promise.resolve(error ? { data: null, error } : { data: rows.slice(from, to + 1), error: null }) },
      maybeSingle: () => Promise.resolve(result),
    }
    return q
  }
  return { calls, from: () => builder(error ? { data: null, error } : { data: rows[0] ?? null, error: null }) }
}

test('noindex ids are paged past the 1,000-row response cap', async () => {
  const rows = Array.from({ length: 1500 }, (_, i) => ({ id: `id-${i}`, noindex: true }))
  const c = client(rows)
  const ids = await noindexArticleIds(c)
  assert.equal(ids.size, 1500)
  assert.deepEqual(c.calls, [[0, 999], [1000, 1999]])
})

test('rows without a true noindex flag are never excluded', async () => {
  const ids = await noindexArticleIds(client([{ id: 'a' }, { id: 'b', noindex: false }, { id: 'c', noindex: true }]))
  assert.deepEqual([...ids], ['c'])
})

test('a missing noindex column lists every article instead of breaking the sitemap', async () => {
  const ids = await noindexArticleIds(client([], { message: 'column articles.noindex does not exist' }))
  assert.equal(ids.size, 0)
  assert.equal(await isArticleNoindex(client([], { message: 'column articles.noindex does not exist' }), 'x'), false)
})

test('an article page reads its own noindex flag', async () => {
  assert.equal(await isArticleNoindex(client([{ noindex: true }]), 'x'), true)
  assert.equal(await isArticleNoindex(client([{ noindex: false }]), 'x'), false)
  assert.equal(await isArticleNoindex(client([]), 'x'), false)
})
