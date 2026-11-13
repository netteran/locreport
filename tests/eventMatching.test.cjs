const { test } = require('node:test')
const assert = require('node:assert/strict')
const ts = require('typescript'),
  fs = require('node:fs')
const moduleExports = { exports: {} }
const compiled = ts.transpileModule(fs.readFileSync('lib/eventMatching.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText
new Function('exports', 'require', 'module', compiled)(
  moduleExports.exports,
  require,
  moduleExports
)
const {
  canonicalSourceUrl,
  normalizeEntity,
  eventIdentity,
  mayAutoPublish,
  validateSourceCitations
} = moduleExports.exports
test('normalizes tracking URLs while preserving meaningful parameters', () => {
  assert.equal(
    canonicalSourceUrl('https://example.org/story/?utm_source=rss&edition=2#top'),
    'https://example.org/story?edition=2'
  )
  assert.throws(() => canonicalSourceUrl('javascript:alert(1)'))
})
test('normalizes entity aliases and distinguishes transaction stages', () => {
  assert.equal(normalizeEntity('RWS Holdings plc'), normalizeEntity('RWS Group'))
  const e = {
    subject: 'RWS',
    object: 'Acolad',
    action: 'acquisition',
    stage: 'announced',
    event_date: '2026-11-13'
  }
  assert.notEqual(eventIdentity(e), eventIdentity({ ...e, stage: 'completed' }))
  assert.equal(eventIdentity(e), eventIdentity({ ...e, subject: 'RWS Holdings plc' }))
})
test('stale, undated, incomplete and opinion evidence cannot auto-publish', () => {
  const now = Date.parse('2026-11-13'),
    e = { newsworthy: true, headline: 'A concrete announcement', event_date: '2026-11-12' }
  assert.equal(mayAutoPublish(e, null, 'full', now), true)
  assert.equal(mayAutoPublish(e, null, 'snippet', now), false)
  assert.equal(mayAutoPublish({ ...e, event_date: '2025-01-01' }, null, 'full', now), false)
  assert.equal(mayAutoPublish({ ...e, event_date: null }, null, 'full', now), false)
  assert.equal(mayAutoPublish({ ...e, newsworthy: false }, null, 'full', now), false)
})
test('generation requires selected citations and rejects invented source URLs', () => {
  const urls = ['https://a.example/news', 'https://b.example/news']
  assert.equal(
    validateSourceCitations('[A](https://a.example/news) [B](https://b.example/news)', urls).size,
    2
  )
  assert.throws(() => validateSourceCitations('[A](https://a.example/news)', urls), /at least two/)
  assert.throws(
    () => validateSourceCitations('[C](https://invented.example/news)', urls),
    /outside/
  )
})

test('single-source articles must cite their source and cannot invent another one', () => {
  const urls = ['https://a.example/news']
  assert.equal(validateSourceCitations('[Source](https://a.example/news)', urls).size, 1)
  assert.throws(() => validateSourceCitations('No attribution.', urls), /cite its selected source/)
  assert.throws(() => validateSourceCitations('[Other](https://b.example/news)', urls), /outside/)
  assert.throws(() => validateSourceCitations('No evidence.', []), /at least one selected source/)
})

test('malformed event dates and transaction stages are held for review', () => {
  const { parseDescriptor } = moduleExports.exports
  const event = {
    subject: 'RWS',
    action: 'acquisition',
    object: 'Acolad',
    stage: 'announced',
    event_date: '2026-11-13',
    headline: 'A concrete acquisition announcement.',
    newsworthy: true,
    entities: [],
    topics: []
  }
  assert.throws(
    () => parseDescriptor({ ...event, event_date: '2026-02-30' }),
    /valid calendar date/
  )
  assert.throws(() => parseDescriptor({ ...event, stage: 'probably happening' }), /Unrecognized/)
})
