const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const { NextRequest } = require('next/server')
const { PGlite } = require('@electric-sql/pglite')

function load(file, dependencies = {}) {
  const m = { exports: {} }
  new Function('exports', 'require', 'module', ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText)(m.exports, id => dependencies[id] || require(id), m)
  return m.exports
}
const notes = load('lib/email/weeklyNote.ts')

test('weekly editions roll over on Saturday in Warsaw, including DST and year boundaries', () => {
  for (const [instant, expected] of [
    ['2026-11-16T10:00:00Z', '2026-11-20'],
    ['2026-11-20T22:59:59Z', '2026-11-20'],
    ['2026-11-20T23:00:00Z', '2026-11-27'],
    ['2026-07-03T21:59:59Z', '2026-07-03'],
    ['2026-07-03T22:00:00Z', '2026-07-10'],
    ['2026-12-31T12:00:00Z', '2027-01-01']
  ]) assert.equal(notes.weeklyEditionDate(new Date(instant)), expected)
})

test('note validation preserves Markdown line breaks, supports clearing and rejects invalid input', () => {
  assert.equal(notes.normalizeWeeklyNote('  Hello\n\nreaders.\t Welcome. '), 'Hello\n\nreaders.\t Welcome.')
  assert.equal(notes.normalizeWeeklyNote('  '), '')
  assert.equal(notes.normalizeWeeklyNote('x'.repeat(2000)).length, 2000)
  for (const value of [null, {}, 1, 'x'.repeat(2001)]) assert.throws(() => notes.normalizeWeeklyNote(value))
})

function fixture() {
  const rows = new Map(), writes = []
  let error = null
  const service = {
    from(table) {
      assert.equal(table, 'weekly_newsletter_notes')
      let date
      const query = {
        select() { return query },
        eq(key, value) { assert.equal(key, 'edition_date'); date = value; return query },
        async maybeSingle() { return { data: rows.get(date) || null, error } },
        async upsert(row) {
          if (!error) { rows.set(row.edition_date, row); writes.push(row) }
          return { error }
        }
      }
      return query
    }
  }
  return { service, rows, writes, fail(value) { error = value } }
}

test('only the current edition is loaded; missing schema fallback does not hide database failures', async () => {
  const f = fixture()
  f.rows.set('2026-11-20', { paragraph: 'This week only.' })
  assert.equal((await notes.loadWeeklyNote(f.service, new Date('2026-11-18'))).paragraph, 'This week only.')
  assert.equal((await notes.loadWeeklyNote(f.service, new Date('2026-11-21'))).paragraph, '')
  f.fail({ code: '42P01', message: 'relation weekly_newsletter_notes does not exist' })
  await assert.rejects(notes.loadWeeklyNote(f.service), /20261116_weekly_newsletter_notes.sql/)
  assert.equal((await notes.loadWeeklyNote(f.service, new Date(), true)).paragraph, '')
  f.fail({ code: '42501', message: 'permission denied' })
  await assert.rejects(notes.loadWeeklyNote(f.service, new Date(), true), /permission denied/)
  f.fail({ code: '42P01', message: 'relation unrelated_table does not exist' })
  await assert.rejects(notes.loadWeeklyNote(f.service, new Date(), true), /unrelated_table/)
})

test('admin API persists edits, supports removal and rejects unauthenticated, invalid and stale saves', async () => {
  const f = fixture()
  let user = null
  const routes = load('app/api/digest/note/route.ts', {
    '@/lib/supabase/server': {
      createClient: async () => ({ auth: { getUser: async () => ({ data: { user } }) } }),
      createServiceClient: () => f.service
    },
    '@/lib/email/weeklyNote': notes
  })
  const put = body => routes.PUT(new NextRequest('http://localhost/api/digest/note', {
    method: 'PUT', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' }
  }))
  const editionDate = notes.weeklyEditionDate()
  assert.equal((await routes.GET()).status, 401)
  assert.equal((await put({ editionDate, paragraph: 'Hello' })).status, 401)
  user = { email: 'not-the-admin@example.test' }
  assert.equal((await routes.GET()).status, 401)
  user = { email: process.env.ADMIN_EMAIL = 'editor@example.test' }
  assert.equal((await put({ editionDate, paragraph: ' Hello\nreaders. ' })).status, 200)
  const result = await routes.GET()
  assert.equal(result.headers.get('Cache-Control'), 'no-store')
  assert.deepEqual(await result.json(), { editionDate, paragraph: 'Hello\nreaders.' })
  for (const paragraph of [null, 'x'.repeat(2001)]) {
    assert.equal((await put({ editionDate, paragraph })).status, 400)
  }
  assert.equal((await put({ editionDate: '2020-01-03', paragraph: 'Stale' })).status, 409)
  assert.equal(f.writes.length, 1)
  assert.equal((await put({ editionDate, paragraph: '' })).status, 200)
  assert.equal((await (await routes.GET()).json()).paragraph, '')
  f.fail({ code: '42P01', message: 'relation weekly_newsletter_notes does not exist' })
  assert.equal((await routes.GET()).status, 503)
  assert.equal((await put({ editionDate, paragraph: 'Hello' })).status, 503)
})

test('email renders the saved paragraph before the top story as escaped text; blank preserves existing email', () => {
  const { digestEmail } = load('lib/email/templates.ts')
  const input = {
    periodLabel: 'Test week', topStory: { title: 'The top story', url: 'https://example.test/story' },
    company: null, facts: [], market: null, directory: [], more: [], moreCount: 0,
    manageUrl: 'https://example.test/manage'
  }
  const plain = digestEmail(input)
  assert.equal(digestEmail({ ...input, editorNote: '   ' }), plain)
  const html = digestEmail({ ...input, editorNote: 'Hello <script>alert(1)</script> & readers.' })
  assert.ok(html.includes('Hello &lt;script&gt;alert(1)&lt;/script&gt; &amp; readers.'))
  assert.ok(!html.includes('<script>'))
  assert.ok(html.indexOf('Hello &lt;script&gt;') < html.indexOf('The top story'))
})

test('shared issue builder includes saved copy without querying signal history and stops on note read failures', async () => {
  let failed = false
  const tables = [], selections = [], composed = []
  const { buildIssue } = load('lib/email/issue.ts', {
    '@/lib/data/directory': { DIRECTORY: [] },
    '@/lib/directory': { fetchDirectoryEntries: async () => [] },
    '@/lib/email/digest': { composeIssue: input => { composed.push(input); return { storyCount: 1 } }, pickCompanyOfWeek: () => null, summarizeMarket: () => null },
    '@/lib/email/period': { fetchPeriodArticles: async () => ({ data: [{ id: 'article' }], error: null }) },
    '@/lib/email/weeklyNote': { loadWeeklyNote: async (_service, date) => {
      assert.equal(date.toISOString(), '2026-11-20T12:00:00.000Z')
      if (failed) throw new Error('Note database unavailable')
      return { paragraph: 'The saved opening.' }
    } }
  })
  const query = { data: [], select(columns) { selections.push(columns); return query }, eq() { return query }, gte() { return query }, lt() { return query }, order() { return query }, limit() { return query } }
  const service = { from(table) { tables.push(table); return query } }
  const start = new Date('2026-11-13T12:00:00Z'), end = new Date('2026-11-20T12:00:00Z')
  assert.deepEqual(await buildIssue(service, start, end), { issue: { storyCount: 1, editorNote: 'The saved opening.' } })
  assert.deepEqual(tables, ['facts', 'market_quotes', 'directory'])
  assert.ok(selections.every(columns => !columns.includes('signal_ids')))
  assert.equal(Object.hasOwn(composed[0], 'priorArticles'), false)
  failed = true
  assert.deepEqual(await buildIssue(service, start, end), { issue: null, error: 'Note database unavailable' })
  assert.equal(tables.length, 3, 'note failures must stop before loading supporting material')
})

test('weekly content query includes newly published Monthly Briefings in the existing article window', async () => {
  const { createClient } = require('@supabase/supabase-js')
  const { fetchPeriodArticles } = load('lib/email/period.ts')
  const publishedBriefing = { id: 'briefing', title: 'October Monthly Briefing', article_type: 'monthly-summary' }
  const requests = []
  const service = createClient('https://fixture.example.test', 'fixture-service', {
    auth: { persistSession: false },
    global: { fetch: async input => {
      const url = new URL(input)
      requests.push(url)
      return new Response(JSON.stringify([publishedBriefing]), { headers: { 'Content-Type': 'application/json' } })
    } }
  })
  const { data, error } = await fetchPeriodArticles(service, new Date('2026-11-13T12:00:00Z'))
  assert.equal(error, null)
  assert.deepEqual(data, [publishedBriefing])
  assert.equal(requests.length, 1)
  assert.equal(requests[0].pathname, '/rest/v1/articles')
  assert.equal(requests[0].searchParams.get('article_type'), 'in.(industry,monthly-summary)')
  assert.equal(requests[0].searchParams.get('published_at'), 'gte.2026-11-13T12:00:00.000Z')
  assert.equal(requests[0].searchParams.get('order'), 'published_at.desc')
  assert.ok(!requests[0].searchParams.get('select').includes('signal_ids'))
})

test('weekly issue includes Monthly Briefings and practical blocks without public scores or tracker links', () => {
  const { composeIssue } = load('lib/email/digest.ts', {
    '@/lib/email/companyLogo': load('lib/email/companyLogo.ts'),
    '@/lib/data/locstock': load('lib/data/locstock.ts'),
    '@/lib/data/directory': load('lib/data/directory.ts'),
    '@/lib/utils': load('lib/utils.ts', { './monthlyReportSlugs': load('lib/monthlyReportSlugs.ts') }),
    '@/lib/email/send': { SITE_URL: 'https://locreport.com' }
  })
  const { digestEmail } = load('lib/email/templates.ts')
  const { load: parseHtml } = require('cheerio')
  const issue = composeIssue({
    articles: [
      { id: 'analysis', title: 'Authored analysis', slug: '2026/11/analysis', excerpt: 'Our research.', impact_score: 5,
        signal_ids: ['quality-gap-closure'], business_implications: ['Review your evaluation budget.'], published_at: '2026-11-18T10:00:00Z' },
      { id: 'second', title: 'Second analysis', slug: 'second', excerpt: null, impact_score: 4,
        signal_ids: ['agentic-localization-workflows'], business_implications: [], published_at: '2026-11-19T10:00:00Z' },
      { id: 'briefing', title: 'October Monthly Briefing', slug: 'october-briefing', excerpt: 'The developments that mattered.',
        article_type: 'monthly-summary', impact_score: null, signal_ids: [], business_implications: [], published_at: '2026-11-20T10:00:00Z' }
    ],
    facts: Array.from({ length: 6 }, (_, i) => ({ id: `fact-${i}`, content: `Confirmed development ${i}.`, article_id: null })),
    company: { name: 'Company of the week', url: 'https://locreport.com/compass/directory/company', logoUrl: null,
      category: 'Language technology', hq: 'Warsaw', founded: 2020, blurb: 'Builds useful localization tools.' },
    market: { avgPct: 4, tracked: 2, movers: [{ symbol: 'RWS', name: 'RWS Holdings', pct: 4 }], url: 'https://locreport.com/compass/locstock' },
    directory: [{ name: 'New company', slug: 'new-company', category: 'Language technology', description: 'A new directory entry.' }]
  })
  assert.equal(issue.storyCount, 3)
  assert.equal(issue.topStory.id, 'analysis')
  assert.deepEqual(issue.more.map(article => article.id), ['second', 'briefing'])
  assert.deepEqual(issue.articleIds, ['analysis', 'second', 'briefing'])
  assert.equal(Object.hasOwn(issue, 'signalMoves'), false)
  const html = digestEmail({
    ...issue, periodLabel: 'Test week', editorNote: 'Our weekly perspective.', manageUrl: 'https://locreport.com/subscribe/manage',
    // Old callers passing tracker data cannot restore the retired public block.
    signalMoves: [{ id: 'legacy', label: 'Legacy signal', url: 'https://locreport.com/intelligence/signals/legacy',
      count: 2, priorAvg: 1, trend: 'up', wasActive: true, lead: issue.topStory }]
  })
  const $ = parseHtml(html)
  for (const text of ['The Weekly', 'Our weekly perspective.', 'Authored analysis', 'Why it matters', 'Review your evaluation budget.',
    'Company of the week', 'Fact Flow', 'LocStock brief', 'New in the directory', 'Second analysis', 'Manage subscription']) {
    assert.ok($('body').text().includes(text), text)
  }
  assert.equal($('a[href="https://locreport.com/articles/analysis"]').length, 2)
  assert.equal($('a[href="https://locreport.com/articles/second"]').length, 1)
  assert.equal($('a[href="https://locreport.com/articles/october-briefing"]').text(), 'October Monthly Briefing')
  assert.equal($('a[href^="https://locreport.com/fact-flow#"]').length, 5)
  assert.equal($('a[href="https://locreport.com/compass/locstock"]').length, 1)
  assert.equal($('a[href="https://locreport.com/compass/directory/new-company"]').length, 1)
  assert.ok(!$('body').text().includes('Confirmed development 5.'))
  assert.doesNotMatch(html, /Signal movement|Legacy signal|intelligence\/signals|previous four weeks|Quiet this week|Major impact|Disruptive impact|>MAJOR<|>DISRUPTIVE</)
})

test('newsletter paragraphs are private in PostgreSQL and constrained to Friday editions', async () => {
  const db = new PGlite()
  try {
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls;')
    await db.exec(fs.readFileSync('supabase/migrations/20261116_weekly_newsletter_notes.sql', 'utf8'))
    await db.exec("insert into weekly_newsletter_notes(edition_date,paragraph) values ('2026-11-20','Private draft')")
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`)
      await assert.rejects(db.query('select * from weekly_newsletter_notes'), /permission denied/)
      await assert.rejects(db.query("insert into weekly_newsletter_notes(edition_date) values ('2026-11-27')"), /permission denied/)
      await db.exec('reset role')
    }
    await db.exec('set role service_role')
    assert.equal((await db.query('select paragraph from weekly_newsletter_notes')).rows[0].paragraph, 'Private draft')
    await db.exec("update weekly_newsletter_notes set paragraph='' where edition_date='2026-11-20'")
    await assert.rejects(db.query("insert into weekly_newsletter_notes(edition_date) values ('2026-11-21')"), /check constraint/)
    await assert.rejects(db.query("update weekly_newsletter_notes set paragraph=repeat('x',2001)"), /check constraint/)
  } finally { await db.close() }
})

test('weekly Markdown renders bold, italics, nested links and escaped markers without double escaping', () => {
  const { renderWeeklyNote } = load('lib/email/templates.ts')
  const { load: parseHtml } = require('cheerio')
  const html = renderWeeklyNote('Hello **readers** and *friends*: [**our _latest_ report**](https://example.com/report?a=1&b=2). \\*Literal\\* & text.')
  const $ = parseHtml(html, null, false)
  assert.equal($('strong').first().text(), 'readers')
  assert.equal($('em').first().text(), 'friends')
  assert.equal($('a strong em').text(), 'latest')
  assert.equal($('a').attr('href'), 'https://example.com/report?a=1&b=2')
  assert.equal($.root().text(), 'Hello readers and friends: our latest report. *Literal* & text.')
  assert.ok(html.includes('a=1&amp;b=2'))
  assert.ok(!html.includes('&amp;amp;'))
  assert.equal(renderWeeklyNote('__bold__ and _italics_'), '<strong>bold</strong> and <em>italics</em>')
  assert.equal(renderWeeklyNote('  Ordinary & unformatted text.  '), 'Ordinary &amp; unformatted text.')
})

test('weekly Markdown never renders source HTML, images, scripts or unsafe link destinations', () => {
  const { renderWeeklyNote } = load('lib/email/templates.ts')
  const { load: parseHtml } = require('cheerio')
  for (const target of [
    'javascript:alert%281%29', 'JaVaScRiPt:alert%281%29',
    'javascript&#x3a;alert%281%29', 'java&#x73;cript:alert%281%29',
    'data:text/html;base64,PHNjcmlwdD4=', 'vbscript:msgbox%281%29',
    'file:///etc/passwd', '//example.com', '/relative/path', 'mailto:editor@example.test'
  ]) {
    const $ = parseHtml(renderWeeklyNote(`[**Read this**](${target})`), null, false)
    assert.equal($('a').length, 0, target)
    assert.ok($.root().text().includes('Read this'), target)
  }
  const raw = '<script>alert(1)</script><img src="https://tracker.test/pixel" onerror="alert(1)"><svg onload="alert(1)"></svg>'
  const $ = parseHtml(renderWeeklyNote(raw + ' ![tracking image](https://tracker.test/pixel)'), null, false)
  assert.equal($('*').length, 0)
  assert.ok($.root().text().includes(raw))
  assert.ok($.root().text().includes('![tracking image](https://tracker.test/pixel)'))
  const link = parseHtml(renderWeeklyNote('[Read](https://example.com/"onclick="alert%281%29)'), null, false)
  assert.equal(link('a').length, 1)
  assert.deepEqual(Object.keys(link('a')[0].attribs).sort(), ['href', 'style'])
  assert.ok(link('a').attr('href').includes('%22'))
})

test('the newsletter template includes formatted opening copy before the top story', () => {
  const { digestEmail } = load('lib/email/templates.ts')
  const { load: parseHtml } = require('cheerio')
  const html = digestEmail({
    periodLabel: 'Test week', editorNote: '**Hello** *readers*: [Read more](https://example.com/report).',
    topStory: { title: 'The top story', url: 'https://example.test/story' },
    company: null, facts: [], market: null, directory: [], more: [], moreCount: 0,
    manageUrl: 'https://example.test/manage'
  })
  const $ = parseHtml(html)
  const intro = $('p').filter((_, element) => $(element).text() === 'Hello readers: Read more.')
  assert.equal(intro.find('strong').text(), 'Hello')
  assert.equal(intro.find('em').text(), 'readers')
  assert.equal(intro.find('a').attr('href'), 'https://example.com/report')
  assert.ok(html.indexOf('<strong>Hello</strong>') < html.indexOf('The top story'))
})

test('newsletter note headings preserve all six levels and inline formatting with email styles', () => {
  const { renderWeeklyNoteContent } = load('lib/email/templates.ts')
  const { load: parseHtml } = require('cheerio')
  const markdown = Array.from({ length: 6 }, (_, i) => `${'#'.repeat(i + 1)} Heading **${i + 1}**`).join('\n\n')
  const $ = parseHtml(renderWeeklyNoteContent(markdown), null, false)
  for (let level = 1; level <= 6; level++) {
    assert.equal($(`h${level}`).length, 1)
    assert.equal($(`h${level} strong`).text(), String(level))
    assert.match($(`h${level}`).attr('style'), /font-size:\d+px/)
  }
  assert.equal($('p :header').length, 0)
})

test('note line breaks survive saving and form headings and separate paragraphs', () => {
  const { renderWeeklyNoteContent } = load('lib/email/templates.ts')
  const { load: parseHtml } = require('cheerio')
  const text = notes.normalizeWeeklyNote('  # Title\r\n\r\nFirst paragraph.\r\nContinued.\r\n\r\n## Next\r\n\r\nSecond paragraph.  ')
  assert.equal(text, '# Title\n\nFirst paragraph.\nContinued.\n\n## Next\n\nSecond paragraph.')
  const $ = parseHtml(renderWeeklyNoteContent(text), null, false)
  assert.deepEqual($.root().children().toArray().map(element => element.tagName), ['h1', 'p', 'h2', 'p'])
  assert.equal($('p').first().text(), 'First paragraph.\nContinued.')
  assert.equal($('p').last().text(), 'Second paragraph.')
})

test('headings keep HTML and dangerous links inert; escaped heading markers remain text', () => {
  const { renderWeeklyNoteContent } = load('lib/email/templates.ts')
  const { load: parseHtml } = require('cheerio')
  const $ = parseHtml(renderWeeklyNoteContent('# <img src=x onerror=alert(1)> [read](javascript:alert%281%29)\n\n<script>alert(1)</script>\n\n\\# Literal heading\n\n####### Too many markers'), null, false)
  assert.equal($('h1').length, 1)
  assert.equal($('img, script, a').length, 0)
  assert.ok($('h1').text().includes('<img src=x onerror=alert(1)> read'))
  assert.ok($.root().text().includes('# Literal heading'))
  assert.ok($.root().text().includes('####### Too many markers'))
})
