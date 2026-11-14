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

test('paragraph validation keeps one plain-text paragraph, supports clearing and rejects invalid input', () => {
  assert.equal(notes.normalizeWeeklyNote('  Hello\n\nreaders.\t Welcome. '), 'Hello readers. Welcome.')
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
  assert.deepEqual(await result.json(), { editionDate, paragraph: 'Hello readers.' })
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
    company: null, signalMoves: [], facts: [], market: null, directory: [], more: [], moreCount: 0,
    manageUrl: 'https://example.test/manage'
  }
  const plain = digestEmail(input)
  assert.equal(digestEmail({ ...input, editorNote: '   ' }), plain)
  const html = digestEmail({ ...input, editorNote: 'Hello <script>alert(1)</script> & readers.' })
  assert.ok(html.includes('Hello &lt;script&gt;alert(1)&lt;/script&gt; &amp; readers.'))
  assert.ok(!html.includes('<script>'))
  assert.ok(html.indexOf('Hello &lt;script&gt;') < html.indexOf('The top story'))
})

test('shared issue builder includes saved copy for previews and sends, and stops on note read failures', async () => {
  let failed = false
  const { buildIssue } = load('lib/email/issue.ts', {
    '@/lib/data/directory': { DIRECTORY: [] },
    '@/lib/directory': { fetchDirectoryEntries: async () => [] },
    '@/lib/email/digest': { SIGNAL_BASELINE_WEEKS: 4, composeIssue: () => ({ storyCount: 1 }), pickCompanyOfWeek: () => null, summarizeMarket: () => null },
    '@/lib/email/period': { fetchPeriodArticles: async () => ({ data: [{ id: 'article' }], error: null }) },
    '@/lib/email/weeklyNote': { loadWeeklyNote: async (_service, date) => {
      assert.equal(date.toISOString(), '2026-11-20T12:00:00.000Z')
      if (failed) throw new Error('Note database unavailable')
      return { paragraph: 'The saved opening.' }
    } }
  })
  const query = { data: [], select() { return query }, eq() { return query }, gte() { return query }, lt() { return query }, order() { return query }, limit() { return query } }
  const service = { from: () => query }
  const start = new Date('2026-11-13T12:00:00Z'), end = new Date('2026-11-20T12:00:00Z')
  assert.deepEqual(await buildIssue(service, start, end), { issue: { storyCount: 1, editorNote: 'The saved opening.' } })
  failed = true
  assert.deepEqual(await buildIssue(service, start, end), { issue: null, error: 'Note database unavailable' })
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
    company: null, signalMoves: [], facts: [], market: null, directory: [], more: [], moreCount: 0,
    manageUrl: 'https://example.test/manage'
  })
  const $ = parseHtml(html)
  const intro = $('p').filter((_, element) => $(element).text() === 'Hello readers: Read more.')
  assert.equal(intro.find('strong').text(), 'Hello')
  assert.equal(intro.find('em').text(), 'readers')
  assert.equal(intro.find('a').attr('href'), 'https://example.com/report')
  assert.ok(html.indexOf('<strong>Hello</strong>') < html.indexOf('The top story'))
})
