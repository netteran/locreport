const { test } = require('node:test')
const assert = require('node:assert/strict')
const { load } = require('./fixtures/typescript.cjs')

const { articleHref, getContentBadge, isArticlePath, isContentType } = load('lib/contentTaxonomy.ts')
const { validateEditorialProtocol, presentBrief } = load('lib/editorialProtocol.ts')
const { feedPageNumber, feedPagePath, validFeedCursor } = load('lib/feedPagination.ts')
const { serializeJsonLd } = load('lib/seo.ts')

test('post paths and badges use the persisted editorial type', () => {
  for (const [type, path, label, color] of [
    ['brief', '/briefs/story/', 'INDUSTRY BRIEF', 'blue'],
    ['analysis', '/analysis/story/', 'LOC ANALYSIS', 'purple'],
    ['report', '/reports/story/', 'MONTHLY REPORT', 'emerald'],
  ]) {
    assert.equal(articleHref({ slug: '2026/11/15/Story', content_type: type }), path)
    assert.equal(isArticlePath(path), true)
    assert.deepEqual(getContentBadge(type), { label, className: `bg-${color}-100 text-${color}-800` })
  }
  assert.equal(articleHref({ slug: 'monthly-report-february-2026', article_type: 'monthly-summary' }), '/reports/february-2026-localization-industry-report/')
  assert.equal(isArticlePath('/analysis/'), false)
  assert.equal(isContentType('articles'), false)
})

test('only positive whole-number feed paths and valid cursors are accepted', () => {
  for (const input of ['0', '-1', '01', '1.5', '1x', '1e2', '2147483647']) assert.equal(feedPageNumber(input), null)
  assert.equal(feedPageNumber('2'), 2)
  assert.equal(feedPagePath(1), '/')
  assert.equal(feedPagePath(2), '/page/2/')
  assert.equal(validFeedCursor({ publishedAt: '2026-11-15T10:00:00+00:00', id: '000-111' }), true)
  assert.equal(validFeedCursor({ publishedAt: '2026-11-15T10:00:00Z,invalid', id: '000-111' }), false)
})

const original = 'https://example.test/news?edition=1'
const lead = `[The original publisher](${original}) announced a new localization service on Monday.`
const paragraph = 'Buyers already evaluating new localization services can use the announcement to identify which workflows the new provider intends to support.'
const takeaways = '## Why this matters\n\n- Buyers can plan a pilot against real project requirements.\n- Procurement teams can verify which languages are covered.'
const footnote = `*Sources: [The original publisher](${original})*`
const brief = [lead, paragraph.repeat(10).replaceAll('.Buyers', '. Buyers'), takeaways, footnote].join('\n\n')

test('brief approval requires inline original credit, two or three takeaways, and the matching final footnote', () => {
  assert.doesNotThrow(() => validateEditorialProtocol('brief', brief, original))
  assert.throws(() => validateEditorialProtocol('brief', brief, null), /valid original source/)
  assert.throws(() => validateEditorialProtocol('brief', brief.replace(lead, 'The publisher made an announcement.'), original), /opening paragraph/)
  assert.throws(() => validateEditorialProtocol('brief', brief.replace(takeaways, '## Why this matters\n\n- One point.'), original), /two or three/)
  assert.throws(() => validateEditorialProtocol('brief', brief.replace(footnote, footnote.slice(1)), original), /End the brief/)
  assert.throws(() => validateEditorialProtocol('brief', brief.replace(footnote, footnote.replace('edition=1', 'edition=2')), original), /End the brief/)
  assert.throws(() => validateEditorialProtocol('brief', [lead, takeaways, footnote].join('\n\n'), original), /200 and 450 words/)
  assert.equal(presentBrief(brief, original, ['First', 'Second']), brief)
})

test('historical brief rendering credits stored evidence and adds real takeaways', () => {
  const legacy = 'A historical brief about the release.\n\nAdditional detail.'
  const rendered = presentBrief(legacy, original, ['First takeaway', 'Second takeaway', 'Third takeaway'])
  assert.match(rendered, /A historical brief about the release. See \[Example\]/)
  assert.match(rendered, /## Why this matters\n\n- First takeaway\n- Second takeaway\n- Third takeaway/)
  assert.match(rendered, /\*Sources: \[Example\]\(https:\/\/example\.test\/news\?edition=1\)\*$/)
  assert.equal(presentBrief(legacy, null, []), legacy)
})

test('analysis citations stay inline, with an exception for official document lists', () => {
  assert.doesNotThrow(() => validateEditorialProtocol('analysis', `The [publisher's market report](${original}) describes the change.`))
  assert.doesNotThrow(() => validateEditorialProtocol('analysis', `- [The publisher](${original}) describes the price impact.`))
  assert.throws(() => validateEditorialProtocol('analysis', `The market changed.\n\n## Sources\n\n- [Publisher](${original})`), /body paragraphs/)
  assert.throws(() => validateEditorialProtocol('analysis', `The market changed.\n\n- [Publisher](${original})`), /body paragraphs/)
  assert.doesNotThrow(() => validateEditorialProtocol('analysis', '## References\n\n- [Official benchmark](https://example.test/research.pdf?edition=1)'))
})

test('structured data remains valid JSON even when post titles contain HTML', () => {
  const object = { headline: '</script><b>Title</b>' }
  const serialized = serializeJsonLd(object)
  assert.doesNotMatch(serialized, /</)
  assert.deepEqual(JSON.parse(serialized), object)
})
