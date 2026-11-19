const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), ts = require('typescript')
const { NextRequest } = require('next/server')
function load(file, deps = {}, clock = Date) {
  const m = { exports: {} }
  new Function('exports', 'require', 'module', 'Date', ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX }
  }).outputText)(m.exports, id => deps[id] || require(id), m, clock)
  return m.exports
}
const matching = load('lib/eventMatching.ts'), reports = load('lib/ingestReport.ts')
const item = (n, overrides = {}) => ({ title: 'A localization development', link: `https://publisher.test/story-${n}`,
  pubDate: new Date().toISOString(), contentSnippet: 'A substantial reported development for language professionals. '.repeat(2), ...overrides })
function fixture({ feeds, sourceError, authorized = true, seen = [], replies = [], article, storeError, rememberError, fetchAdvancesClock = false } = {}) {
  feeds ||= [{ id: 'feed', name: 'Publisher', url: 'https://publisher.test/feed', keywords: [], items: [] }]
  const health = [], models = [], saved = [], remembered = [], fetched = [], tables = []
  const clock = { now: Date.now() }
  class Clock extends Date { constructor(value) { super(value === undefined ? clock.now : value) } static now() { return clock.now } }
  const service = { from(table) {
    tables.push(table)
    assert.ok(['rss_sources', 'settings'].includes(table), 'collection must not publish articles/facts')
    let update, ids
    const q = { select() { return q }, eq() { return q }, in(_key, values) { ids = values; return q },
      update(value) { update = value; health.push(value); return q },
      async single() { return { data: { value: 'Extract reported facts.' }, error: null } },
      then(resolve, reject) { return Promise.resolve({ data: update ? null : feeds.filter(f => !ids || ids.includes(f.id)), error: update ? null : sourceError || null }).then(resolve, reject) }
    }
    return q
  } }
  const route = load('app/api/ingest/route.ts', {
    '@/lib/supabase/server': { createClient: async () => ({ auth: { getUser: async () => ({ data: { user: authorized ? { email: process.env.ADMIN_EMAIL } : null } }) } }), createServiceClient: () => service },
    '@/lib/adminAuth': { isCronRequest: () => false, requireResearchSchema: async () => null },
    '@/lib/rss': { isGoogleNewsUrl: () => false, fetchFeedResult: async url => {
      fetched.push(url)
      const feed = feeds.find(f => f.url === url)
      if (fetchAdvancesClock) clock.now += 241000
      return { items: feed.items || [], error: feed.error || null }
    }, fetchArticleSource: async url => article ? article(url) : null },
    '@/lib/prompts': { DEFAULT_EXTRACTOR_PROMPT: 'Extractor', todayLine: () => 'Today' },
    '@/lib/seenUrls': { loadSeenUrls: async () => new Set(seen), rememberSeenUrl: async (_service, url) => {
      if (rememberError) throw new Error(rememberError)
      remembered.push(url)
    } },
    '@/lib/research': { storeCandidate: async (_service, value) => { if (storeError) throw new Error(storeError); saved.push(value) } },
    '@/lib/eventMatching': matching, '@/lib/ingestReport': reports,
    '@/lib/openai': { getOpenAI: () => ({ chat: { completions: { create: async (input, options) => {
      models.push({ input, options })
      const output = replies[models.length - 1] ?? 'Supported reported facts.'
      if (output instanceof Error) throw output
      return { choices: [{ message: { content: output } }] }
    } } } }) }
  }, Clock)
  return { health, models, saved, remembered, fetched, tables,
    run: query => route.POST(new NextRequest('http://localhost/api/ingest' + (query || ''), { method: 'POST' })) }
}

test('a relevant sixteenth item is collected after fifteen keyword misses, including body-only relevance', async () => {
  for (const bodyOnly of [false, true]) {
    const items = Array.from({ length: 16 }, (_, n) => item(n, { title: 'An unrelated report' }))
    if (!bodyOnly) items[15].title = 'Localization changes'
    const f = fixture({ feeds: [{ id: 'feed', name: 'Publisher', url: 'https://publisher.test/feed', keywords: ['localization'], items }],
      article: bodyOnly ? url => ({ url, text: url.endsWith('15') ? 'Localization is discussed in this substantial reported development. '.repeat(2) : 'Unrelated business coverage. '.repeat(5) }) : undefined })
    const response = await f.run(), result = await response.json()
    assert.equal(response.status, 200)
    assert.equal(result.processed, 1)
    assert.equal(result.source_results[0].keyword_misses, 15)
    assert.equal(result.source_results[0].deferred, 0)
    assert.equal(f.models.length, 1)
    assert.equal(f.saved[0].source_url, items[15].link)
    assert.ok(f.models[0].options.timeout <= 30000)
  }
})

test('fifteen eligible extractions remain the per-feed budget and additional entries are explicit', async () => {
  const f = fixture({ feeds: [{ id: 'feed', url: 'https://publisher.test/feed', items: Array.from({ length: 18 }, (_, n) => item(n)) }] })
  const result = await (await f.run()).json()
  assert.equal(result.processed, 15)
  assert.equal(result.source_results[0].deferred, 3)
  assert.equal(result.complete, false)
  assert.equal(f.models.length, 15)
})

test('failed feeds are visible alongside healthy feeds and recorded in fetch health', async () => {
  const f = fixture({ feeds: [
    { id: 'bad', name: 'Blocked publisher', url: 'https://blocked.test/feed', error: 'HTTP 403', items: [] },
    { id: 'good', name: 'Working publisher', url: 'https://publisher.test/feed', items: [item(1)] }
  ] })
  const result = await (await f.run()).json()
  assert.equal(result.processed, 1)
  assert.equal(result.complete, false)
  assert.match(result.errors[0], /Blocked publisher.*HTTP 403/)
  assert.equal(result.source_results[0].status, 'error')
  assert.equal(result.source_results[0].error, 'HTTP 403')
  assert.equal(f.health[0].last_fetch_error, 'HTTP 403')
  assert.equal(result.source_results[1].collected, 1)
})

test('a zero result distinguishes age, invalid entries, duplicates, keyword exclusions and rejected content', async () => {
  const known = item(1)
  const items = [item(0, { pubDate: '2020-01-01' }), known, item(2, { pubDate: 'invalid date' }),
    item(3, { link: '' }), item(4, { link: 'javascript:alert(1)' }),
    item(5, { title: 'Unrelated content' }), item(6, { contentSnippet: 'short' }), item(7)]
  const f = fixture({ feeds: [{ id: 'feed', url: 'https://publisher.test/feed', keywords: ['localization'], items }],
    seen: [known.link + '?utm_source=earlier'], replies: ['UNUSABLE_CONTENT'] })
  const result = await (await f.run()).json(), detail = result.source_results[0]
  assert.equal(result.processed, 0)
  assert.equal(result.skipped, 2)
  assert.equal(detail.old, 1)
  assert.equal(detail.invalid, 3)
  assert.equal(detail.seen, 1)
  assert.equal(detail.keyword_misses, 1)
  assert.equal(detail.short_text, 1)
  assert.equal(detail.unusable, 1)
  assert.deepEqual(detail.rejections, [{ url: items[6].link, reason: 'short_text' }, { url: items[7].link, reason: 'unusable' }])
  assert.equal(f.models.length, 1)
  assert.deepEqual(result.errors, [])
})

test('resolved duplicate URLs and repeated feed URLs never spend extra extraction calls', async () => {
  const duplicate = item(1)
  const f = fixture({ feeds: [{ id: 'feed', url: 'https://publisher.test/feed', items: [duplicate, duplicate, item(2)] }],
    seen: ['https://original.test/already-collected'], article: url => url.endsWith('2') ? { url: 'https://original.test/already-collected', text: 'Existing evidence. '.repeat(10) } : null })
  const result = await (await f.run()).json()
  assert.equal(result.processed, 1)
  assert.equal(result.source_results[0].seen, 2)
  assert.equal(f.models.length, 1)
})

test('database source failures fail closed and an empty source list is explicitly empty', async () => {
  const failed = fixture({ sourceError: { message: 'Database unavailable' } })
  const response = await failed.run()
  assert.equal(response.status, 500)
  assert.match((await response.json()).error, /Could not load RSS sources/)
  assert.equal(failed.fetched.length, 0)
  const empty = await (await fixture({ feeds: [] }).run()).json()
  assert.deepEqual(empty.source_results, [])
  assert.equal(empty.complete, true)
})

test('authentication, source scoping and podcast separation remain in place', async () => {
  const denied = fixture({ authorized: false })
  assert.equal((await denied.run()).status, 401)
  assert.equal(denied.tables.length, 0)
  const f = fixture({ feeds: [
    { id: 'selected', url: 'https://selected.test/feed', items: [] },
    { id: 'other', url: 'https://other.test/feed', items: [] },
    { id: 'podcast', kind: 'podcast', url: 'https://podcast.test/feed', items: [] }
  ] })
  await f.run('?sources=selected,podcast')
  assert.deepEqual(f.fetched, ['https://selected.test/feed'])
})

test('extraction and save failures are counted without losing successful saved-candidate counts', async () => {
  for (const options of [{ replies: [new Error('Extractor failed')] }, { storeError: 'Save failed' }]) {
    const f = fixture({ ...options, feeds: [{ id: 'feed', url: 'https://publisher.test/feed', items: [item(1)] }] })
    const result = await (await f.run()).json()
    assert.equal(result.processed, 0)
    assert.equal(result.source_results[0].failed, 1)
    assert.equal(result.errors.length, 1)
  }
  const f = fixture({ rememberError: 'History write failed', feeds: [{ id: 'feed', url: 'https://publisher.test/feed', items: [item(1)] }] })
  const result = await (await f.run()).json()
  assert.equal(result.processed, 1, 'a stored candidate is still collected when remembering its alias fails')
  assert.equal(result.source_results[0].collected, 1)
  assert.equal(result.errors.length, 1)
})

test('time exhaustion reports unexamined work without sending an expired model request', async () => {
  const f = fixture({ fetchAdvancesClock: true, feeds: [
    { id: 'first', url: 'https://publisher.test/feed', items: [item(1)] },
    { id: 'second', url: 'https://other.test/feed', items: [item(2)] }
  ] })
  const result = await (await f.run()).json()
  assert.equal(result.complete, false)
  assert.equal(result.source_results[0].deferred, 1)
  assert.equal(result.source_results[1].status, 'deferred')
  assert.equal(result.errors.length, 1)
  assert.equal(f.models.length, 0)
  assert.equal(f.fetched.length, 1)
})

test('collection details explain zero results and escape publisher text', () => {
  const React = require('react'), { renderToStaticMarkup } = require('react-dom/server')
  const { IngestDetails } = load('components/IngestDetails.tsx')
  const report = reports.sourceResult({ id: 'source', name: '<script>unsafe()</script>', url: 'https://publisher.test/feed' })
  report.items = 12; report.seen = 8; report.keyword_misses = 2; report.short_text = 1; report.unusable = 1
  report.rejections = [{ url: 'https://publisher.test/unusable', reason: 'unusable' }]
  const html = renderToStaticMarkup(React.createElement(IngestDetails, { sources: [report] }))
  for (const text of ['12 feed entries', '8 previously collected', '2 outside keywords', 'text too short', 'unusable content']) assert.ok(html.includes(text))
  assert.ok(!html.includes('<script>'))
  assert.ok(html.includes('https://publisher.test/unusable'))
})
