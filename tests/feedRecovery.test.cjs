const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), ts = require('typescript')
const { NextRequest } = require('next/server')
function load(file, dependencies = {}) {
  const m = { exports: {} }
  new Function('exports', 'require', 'module', ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText)(m.exports, id => dependencies[id] || require(id), m)
  return m.exports
}
const generator = load('lib/feedGenerator.ts', { '@/lib/utils': load('lib/utils.ts'),
  '@/lib/feedUrl': { feedUrl: name => 'https://locreport.test/api/feeds/' + name } })
const source = { id: 'source', name: 'Publisher', type: 'html', url: 'https://publisher.test/blog/',
  article_selector: '.old-card', title_selector: 'h2', link_selector: 'a', link_pattern: '/blog/',
  content_filter: null, classified_links: {} }
function page(t, body, status = 200) {
  const original = global.fetch
  t.after(() => { global.fetch = original })
  global.fetch = async () => new Response(body, { status })
}
test('a selector failure recovers only publisher-declared Article metadata and preserves dates', async t => {
  const article = { '@type': 'https://schema.org/NewsArticle', headline: 'A publisher announcement',
    mainEntityOfPage: { '@id': 'https://publisher.test/blog/announcement' }, description: 'Reported evidence.', datePublished: '2026-11-18' }
  page(t, `<html><script type="application/ld+json">${JSON.stringify({ '@graph': [{ '@type': 'ItemList', itemListElement: [{ '@type': 'ListItem', item: article }, { '@type': 'ListItem', item: article }] }] })}</script></html>`)
  const result = await generator.generateFeedForSource(source)
  assert.equal(result.itemCount, 1)
  assert.match(result.xml, /A publisher announcement/)
  assert.match(result.xml, /<pubDate>Wed, 18 Nov 2026 00:00:00 GMT<\/pubDate>/)
  assert.match(result.xml, /https:\/\/publisher.test\/blog\/announcement/)
})
test('selector failure cannot promote menu links, external metadata, listing pages or fake Article types', async t => {
  const nodes = [
    { '@type': 'WebSite', headline: 'Navigation', url: 'https://publisher.test/blog/product' },
    { '@type': 'NewsArticleCategory', headline: 'Category', url: 'https://publisher.test/blog/category' },
    { '@type': 'Article', headline: 'External story', url: 'https://unrelated.test/blog/story' },
    { '@type': 'Article', headline: 'Listing', url: source.url }
  ]
  page(t, `<nav><a href="/blog/product">A tempting navigation label</a></nav><script type="application/ld+json">${JSON.stringify(nodes)}</script>`)
  await assert.rejects(generator.generateFeedForSource(source), /keeping the previous feed/)
})
test('working configured selectors retain precedence over recovery metadata', async t => {
  page(t, `<div class="old-card"><h2>Configured article</h2><a href="/blog/configured">Read more</a></div>
    <script type="application/ld+json">{"@type":"Article","headline":"Other metadata","url":"https://publisher.test/blog/other"}</script>`)
  const result = await generator.generateFeedForSource(source)
  assert.match(result.xml, /Configured article/)
  assert.doesNotMatch(result.xml, /Other metadata/)
})
test('metadata recovery applies content filtering before limiting the output item count', async t => {
  const nodes = Array.from({ length: 21 }, (_, n) => ({ '@type': 'Article',
    headline: n === 20 ? 'A translation development' : 'Unrelated business coverage', url: `https://publisher.test/blog/story-${n}` }))
  page(t, `<script type="application/ld+json">${JSON.stringify(nodes)}</script>`)
  const result = await generator.generateFeedForSource({ ...source, content_filter: { keywords: ['translation'], checkFullContent: false, maxScan: 50 } })
  assert.equal(result.itemCount, 1)
  assert.match(result.xml, /story-20/)
})
test('native RSS retains source content filters; an HTML challenge cannot become a successful empty feed', async t => {
  page(t, '<rss version="2.0"><channel><item><title>A translation development</title><link>https://publisher.test/news/one</link><pubDate>Wed, 18 Nov 2026 10:00:00 GMT</pubDate></item><item><title>Unrelated sports</title><link>https://publisher.test/news/two</link></item></channel></rss>')
  const result = await generator.generateFeedForSource({ ...source, type: 'rss', content_filter: { keywords: ['translation'], checkFullContent: false } })
  assert.equal(result.itemCount, 1)
  assert.match(result.xml, /translation development/)
  assert.doesNotMatch(result.xml, /Unrelated sports/)
  global.fetch = async () => new Response('<html><body>Security challenge</body></html>')
  await assert.rejects(generator.generateFeedForSource({ ...source, type: 'rss' }), /Expected an RSS or Atom document/)
})
test('Lingopal recovery stays below the new blog path and excludes product navigation', async t => {
  page(t, '<a href="/solutions/live-dubbing">Live dubbing product</a><a href="/blog">Blog home</a><a href="/blog/">Blog archive</a><a href="/blog/category/broadcasting">Broadcasting category</a><a href="/blog/translation-workflows">Translation workflow evidence</a><a href="https://other.test/blog/story">An unrelated publisher story</a>')
  const result = await generator.generateFeedForSource({ ...source, name: 'LingopalAI', url: 'https://lingopal.ai/blog', article_selector: null })
  assert.equal(result.itemCount, 1)
  assert.match(result.xml, /https:\/\/lingopal.ai\/blog\/translation-workflows/)
  assert.doesNotMatch(result.xml, /live-dubbing|Blog home|Blog archive|Broadcasting category|other.test/)
})

test('a failed feed write is reported as failure and keeps previous XML while other sources continue', async () => {
  const rows = [{ id: 'bad', name: 'First', generated_xml: '<rss>previous</rss>' }, { id: 'good', name: 'Second', generated_xml: '<rss>older</rss>' }]
  const service = { from() {
    let update, id
    const q = { select() { return q }, eq(key, value) { if (key === 'id') id = value; return q },
      update(value) { update = value; return q },
      then(resolve, reject) {
        if (!update) return Promise.resolve({ data: rows, error: null }).then(resolve, reject)
        const error = id === 'bad' && update.generated_xml ? { message: 'Storage unavailable' } : null
        if (!error) Object.assign(rows.find(row => row.id === id), update)
        return Promise.resolve({ data: null, error }).then(resolve, reject)
      } }
    return q
  } }
  const route = load('app/api/scraped-sources/run/route.ts', {
    '@/lib/adminAuth': { isCronRequest: () => true },
    '@/lib/supabase/server': { createServiceClient: () => service },
    '@/lib/feedGenerator': { generateFeedForSource: async () => ({ xml: '<rss>new</rss>', itemCount: 2, classifiedLinks: {} }) }
  })
  const result = await (await route.POST(new NextRequest('http://localhost/api/scraped-sources/run', { method: 'POST' }))).json()
  assert.equal(result.failed, 1); assert.equal(result.succeeded, 1)
  assert.match(result.results[0].error, /Could not save regenerated feed/)
  assert.equal(rows[0].generated_xml, '<rss>previous</rss>')
  assert.equal(rows[1].generated_xml, '<rss>new</rss>')
})

test('generated-feed reads cannot reuse a 30-minute cached body after regeneration', async () => {
  let xml = '<rss>previous</rss>'
  const route = load('app/api/feeds/[name]/route.ts', { '@/lib/supabase/server': { createServiceClient: () => ({ from() {
    const q = { select() { return q }, eq() { return q }, single: async () => ({ data: { active: true, generated_xml: xml }, error: null }) }
    return q
  } }) } })
  const request = new Request('http://localhost/api/feeds/publisher'), params = { params: Promise.resolve({ name: 'publisher' }) }
  const before = await route.GET(request, params)
  assert.equal(await before.text(), '<rss>previous</rss>')
  assert.equal(before.headers.get('Cache-Control'), 'no-store')
  xml = '<rss>regenerated</rss>'
  const after = await route.GET(request, params)
  assert.equal(after.headers.get('Cache-Control'), 'no-store')
  assert.equal(await after.text(), xml)
})

test('feed regeneration cannot authorize Bearer undefined when the cron secret is absent', async t => {
  const original = process.env.CRON_SECRET; delete process.env.CRON_SECRET
  t.after(() => { if (original === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = original })
  const client = { createClient: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
    createServiceClient: () => assert.fail('Unauthorized request must not regenerate feeds') }
  const auth = load('lib/adminAuth.ts', { '@/lib/supabase/server': client, '@/lib/researchSchema': {} })
  const route = load('app/api/scraped-sources/run/route.ts', { '@/lib/adminAuth': auth, '@/lib/supabase/server': client, '@/lib/feedGenerator': {} })
  assert.equal((await route.POST(new NextRequest('http://localhost/api/scraped-sources/run', { method: 'POST', headers: { Authorization: 'Bearer undefined' } }))).status, 401)
})

test('feed repair migration is idempotent and preserves XML, filters, history and edited selectors', async () => {
  const { PGlite } = require('@electric-sql/pglite'), db = new PGlite()
  try {
    await db.exec(fs.readFileSync('supabase/migrations/20260906_scraped_sources.sql', 'utf8'))
    await db.exec(fs.readFileSync('supabase/migrations/20260914_scraped_source_keywords.sql', 'utf8'))
    await db.exec("update scraped_sources set generated_xml='<rss>retained</rss>', keywords=array['translation'], last_status='error' where name in ('LingopalAI','PRNewswire-L10N')")
    const before = (await db.query("select name, content_filter from scraped_sources where name='PRNewswire-L10N'")).rows[0]
    const migration = fs.readFileSync('supabase/migrations/20261125_ingest_feed_repairs.sql', 'utf8')
    await db.exec(migration); await db.exec(migration)
    const rows = (await db.query("select * from scraped_sources where name in ('LingopalAI','PRNewswire-L10N') order by name")).rows
    assert.equal(rows[0].url, 'https://lingopal.ai/blog')
    assert.equal(rows[0].article_selector, null)
    assert.equal(rows[1].type, 'rss')
    assert.equal(rows[1].url, 'https://www.prnewswire.com/rss/news-releases-list.rss')
    assert.deepEqual(rows[1].content_filter, before.content_filter)
    for (const row of rows) { assert.equal(row.generated_xml, '<rss>retained</rss>'); assert.deepEqual(row.keywords, ['translation']); assert.equal(row.last_status, 'error') }
    await db.exec("update scraped_sources set url='https://lingopal.ai/industrynews-blog',article_selector='.editor-custom' where name='LingopalAI'")
    await db.exec(migration)
    assert.equal((await db.query("select article_selector from scraped_sources where name='LingopalAI'")).rows[0].article_selector, '.editor-custom')
  } finally { await db.close() }
})
