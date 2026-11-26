const { test } = require('node:test')
const assert = require('node:assert/strict')
const { load } = require('./fixtures/typescript.cjs')

const { articleHref, getContentBadge, isArticlePath, isContentType } = load('lib/contentTaxonomy.ts')
const { validateEditorialProtocol, presentBrief, stripTakeaways, ensureBriefSourcing, sourceKey } = load('lib/editorialProtocol.ts')
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
const brief = [lead, paragraph.repeat(10).replaceAll('.Buyers', '. Buyers'), footnote].join('\n\n')

test('brief approval requires the matching final footnote, not an opening link or takeaways', () => {
  assert.doesNotThrow(() => validateEditorialProtocol('brief', brief, original))
  assert.throws(() => validateEditorialProtocol('brief', brief, null), /valid original source/)
  // The opening paragraph no longer has to link the source (owner's call, 2026-11-26).
  assert.doesNotThrow(() => validateEditorialProtocol('brief', brief.replace(lead, 'The publisher made an announcement on Monday about a new localization service.'), original))
  assert.throws(() => validateEditorialProtocol('brief', brief.replace(footnote, footnote.slice(1)), original), /End the brief/)
  assert.throws(() => validateEditorialProtocol('brief', brief.replace(footnote, footnote.replace('edition=1', 'edition=2')), original), /End the brief/)
  assert.throws(() => validateEditorialProtocol('brief', [lead, footnote].join('\n\n'), original), /200 and 450 words/)
  assert.equal(presentBrief(brief, original), brief)
})

test('brief credits accept the same source written differently', () => {
  const episode = 'https://www.youtube.com/watch?v=abc123XYZ'
  assert.equal(sourceKey('https://youtu.be/abc123XYZ?si=share'), sourceKey(episode))
  assert.equal(sourceKey('https://m.youtube.com/watch?v=abc123XYZ&t=42'), sourceKey(episode))
  assert.equal(sourceKey('https://example.test/news/?utm_source=x&edition=1'), sourceKey('https://www.example.test/news?edition=1'))
  assert.notEqual(sourceKey('https://example.test/news?edition=2'), sourceKey(original))
  const shortForm = brief.replaceAll(original, 'https://www.example.test/news/?edition=1&utm_medium=feed')
  assert.doesNotThrow(() => validateEditorialProtocol('brief', shortForm, original))
  assert.throws(() => validateEditorialProtocol('brief', brief.replace(footnote, '*Sources: [Elsewhere](https://other.test/x)*'), original),
    /End the brief with \*Sources: \[Source Name\]\(https:\/\/example\.test\/news\?edition=1\)\*/)
})

test('generated briefs get the closing Sources line publishing requires', () => {
  const body = paragraph.repeat(10).replaceAll('.Buyers', '. Buyers')
  const episode = 'https://www.youtube.com/watch?v=abc123XYZ'
  const opening = 'The Signal Room Podcast discussed agentic localization this week.'
  const uncredited = ['# Episode brief', opening, body].join('\n\n')
  const credited = ensureBriefSourcing(uncredited, episode, 'The Signal Room Podcast')
  assert.ok(credited.startsWith(['# Episode brief', opening, body].join('\n\n')), 'the opening paragraph is left as written')
  assert.match(credited, /\n\n\*Sources: \[The Signal Room Podcast\]\(https:\/\/www\.youtube\.com\/watch\?v=abc123XYZ\)\*$/)
  assert.doesNotThrow(() => validateEditorialProtocol('brief', credited, episode))
  // A wrong Sources line is replaced; a correct brief is left exactly as it was.
  const wrongNote = ensureBriefSourcing(brief.replace(footnote, '*Sources: [Elsewhere](https://other.test/x)*'), original)
  assert.doesNotThrow(() => validateEditorialProtocol('brief', wrongNote, original))
  assert.equal(ensureBriefSourcing(brief, original), brief)
  // Rendering keeps an existing multi-source line untouched.
  const multi = brief.replace(footnote, `*Sources: [A](${original}), [B](https://other.test/x)*`)
  assert.equal(presentBrief(multi, original), multi)
})

test('stored "Why this matters" bullet lists are removed when a brief renders', () => {
  const stored = [lead, paragraph, takeaways, footnote].join('\n\n')
  assert.equal(presentBrief(stored, original), [lead, paragraph, footnote].join('\n\n'))
  assert.equal(stripTakeaways(`${paragraph}\n\n${takeaways}`), paragraph)
  const prose = `${paragraph}\n\n## Why this matters\n\nA written section that argues a point.`
  assert.equal(stripTakeaways(prose), prose)
})

test('historical brief rendering credits stored evidence without adding takeaways', () => {
  const legacy = 'A historical brief about the release.\n\nAdditional detail.'
  const rendered = presentBrief(legacy, original)
  assert.ok(rendered.startsWith(legacy + '\n\n'), 'the copy itself is not rewritten')
  assert.doesNotMatch(rendered, /Why this matters/)
  assert.match(rendered, /\*Sources: \[Example\]\(https:\/\/example\.test\/news\?edition=1\)\*$/)
  assert.equal(presentBrief(legacy, null), legacy)
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
