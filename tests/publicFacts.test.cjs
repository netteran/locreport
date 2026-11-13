const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'),
  ts = require('typescript')
const { createClient } = require('@supabase/supabase-js')
const { createFixtureServer } = require('./fixtures/supabase.cjs')
function load(file, dependencies = {}) {
  const m = { exports: {} }
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText
  new Function('exports', 'require', 'module', code)(
    m.exports,
    (id) => dependencies[id] || require(id),
    m
  )
  return m.exports
}
const schema = load('lib/researchSchema.ts')
const { loadPublishedFacts } = load('lib/publicFacts.ts', { '@/lib/researchSchema': schema })
async function fixture(t, mode) {
  const requests = [],
    server = createFixtureServer(mode, requests)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))
  return {
    client: createClient(`http://127.0.0.1:${server.address().port}`, 'fixture-anon', {
      auth: { persistSession: false, autoRefreshToken: false }
    }),
    requests
  }
}
test('migrated schema includes independently published facts and excludes pending facts', async (t) => {
  const { client, requests } = await fixture(t, 'research')
  const facts = await loadPublishedFacts(client)
  assert.equal(facts.length, 2)
  assert.equal(
    facts.some((f) => f.article_id === null),
    true
  )
  assert.equal(
    facts.some((f) => f.content === 'Private pending fact'),
    false
  )
  assert.equal(facts[0].sources.length, 2)
  assert.equal(facts[0].analyses[0].slug, 'combined-analysis')
  assert.equal(requests.filter((r) => r.path === '/rest/v1/facts').length, 1)
})
test('unmigrated schema falls back to article-linked facts without exposing parked facts', async (t) => {
  const { client, requests } = await fixture(t, 'legacy')
  const facts = await loadPublishedFacts(client, 4)
  assert.equal(facts.length, 1)
  assert.equal(facts[0].published_at, facts[0].created_at)
  assert.equal(facts[0].event_id, null)
  assert.equal(facts[0].source_url, 'https://example.test/announcement')
  assert.equal(facts[0].analyses[0].slug, 'combined-analysis')
  const legacyQuery = requests.filter((r) => r.path === '/rest/v1/facts')[1].query
  assert.equal(legacyQuery.article_id, 'not.is.null')
  assert.equal(legacyQuery.limit, '4')
  assert.equal(
    requests.some((r) =>
      ['/rest/v1/public_fact_sources', '/rest/v1/fact_article_links'].includes(r.path)
    ),
    false
  )
})
test('only the absent new facts columns permit a legacy fallback', () => {
  for (const column of ['event_id', 'status', 'published_at'])
    assert.equal(
      schema.missingPublicationColumns({
        code: '42703',
        message: `column facts.${column} does not exist`
      }),
      true
    )
  assert.equal(
    schema.missingPublicationColumns({
      code: 'PGRST204',
      message: "Could not find the 'event_id' column of 'facts' in the schema cache"
    }),
    true
  )
  for (const error of [
    { code: '42703', message: 'column articles.content does not exist' },
    { code: '42501', message: 'permission denied' },
    { code: '08006', message: 'connection failed' },
    { code: '42P01', message: 'facts does not exist' }
  ])
    assert.equal(schema.missingPublicationColumns(error), false)
})
test('real database failures remain errors instead of becoming an empty or legacy stream', async () => {
  let calls = 0
  const client = {
    from() {
      calls++
      return {
        select() {
          return this
        },
        eq() {
          return this
        },
        order() {
          return this
        },
        limit() {
          return Promise.resolve({
            data: null,
            error: { code: '42501', message: 'permission denied' }
          })
        }
      }
    }
  }
  await assert.rejects(loadPublishedFacts(client), /permission denied/)
  assert.equal(calls, 1)
})
test('new workflow readiness requires migration, while an upgraded schema is ready', async (t) => {
  const old = await fixture(t, 'legacy'),
    modern = await fixture(t, 'research')
  assert.match(await schema.researchSchemaProblem(old.client), /20261113_research_publications.sql/)
  assert.equal(await schema.researchSchemaProblem(modern.client), null)
})
