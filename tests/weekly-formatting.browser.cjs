// Renders locally by default; TEST_BASE_URL also exercises real save/preview routes
// against the isolated Supabase fixture. It never calls the send endpoint.
const { chromium } = require('playwright')
const assert = require('node:assert/strict')
const fs = require('node:fs'), ts = require('typescript')
const issue = require('./fixtures/newsletter.cjs')
function load(file, dependencies = {}) {
  const module = { exports: {} }
  new Function('exports', 'require', 'module', ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText)(module.exports, id => dependencies[id] || require(id), module)
  return module.exports
}
const { digestEmail, editedDigestEmail } = load('lib/email/templates.ts')
const { issueMarkdown } = load('lib/email/edition.ts', {
  './issue': {}, './weeklyNote': {}, '@/lib/utils': {}, './send': { SITE_URL: 'https://locreport.com' },
})
;(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  try {
    const context = await browser.newContext({ viewport: { width: 640, height: 1000 }, reducedMotion: 'reduce' })
    await context.route('**/*', route => {
      const url = new URL(route.request().url())
      if (url.hostname === 'locreport.com' && ['/icon.png', '/logolight.png', '/logodark.png'].includes(url.pathname)) return route.fulfill({ contentType: 'image/png', body: fs.readFileSync('public' + url.pathname) })
      return ['127.0.0.1', 'localhost'].includes(url.hostname) ? route.continue() : route.abort()
    })
    const page = await context.newPage(), errors = []
    page.on('pageerror', error => errors.push(error.message))
    const output = 'work/weekly-preview'
    fs.mkdirSync(output, { recursive: true })
    const manageUrl = 'https://locreport.com/subscribe/manage?token=preview'
    await page.setContent(digestEmail({ ...issue, periodLabel: '13–20 November 2026', manageUrl, browserUrl: 'https://locreport.com/the-weekly/' + 'a'.repeat(64) }), { waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: 'The Weekly', exact: true }).waitFor()
    assert.match(await page.getByRole('link', { name: 'View in browser', exact: true }).getAttribute('href'), /\/the-weekly\/[a-f0-9]{64}$/)
    assert.equal(await page.locator('.newsletter-masthead').evaluate(e => getComputedStyle(e).backgroundColor), 'rgb(229, 241, 255)')
    await page.screenshot({ path: output + '/automatic-reference.png', fullPage: true })
    await page.setViewportSize({ width: 320, height: 1000 })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'automatic newsletter overflows at 320px')
    await page.setViewportSize({ width: 640, height: 1000 })
    const copy = issueMarkdown(issue).replace('https://publisher.example.test/review', 'https://publisher.example.test/reviewed-source')
    const base = process.env.TEST_BASE_URL
    if (base) {
      const now = Math.floor(Date.now() / 1000), user = { id: '90000000-0000-4000-8000-000000000001', email: 'editor@example.test', aud: 'authenticated', role: 'authenticated' }
      const token = [Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'), Buffer.from(JSON.stringify({ sub: user.id, email: user.email, aud: user.aud, role: user.role, iat: now, exp: now + 3600 })).toString('base64url'), 'fixture'].join('.')
      await context.addCookies([{ name: 'sb-127-auth-token', url: base, value: 'base64-' + Buffer.from(JSON.stringify({ access_token: token, refresh_token: 'fixture-refresh', expires_at: now + 3600, expires_in: 3600, token_type: 'bearer', user })).toString('base64url') }])
      const current = await context.request.get(base + '/api/digest/edition')
      assert.equal(current.status(), 200)
      const edition = await current.json()
      const saved = await context.request.put(base + '/api/digest/edition', { data: { ...edition, subject: 'Reviewed weekly edition', body_markdown: copy } })
      assert.equal(saved.status(), 200)
      const { revision } = await saved.json()
      assert.equal((await page.goto(base + '/api/digest/preview?revision=' + revision, { waitUntil: 'networkidle' })).status(), 200)
      assert.equal((await (await context.request.get(base + '/api/digest/edition')).json()).body_markdown, copy)
    } else {
      await page.setContent(editedDigestEmail({ editionDate: '2026-11-20', bodyMarkdown: copy, manageUrl }), { waitUntil: 'networkidle' })
    }
    assert.equal(await page.locator('[data-newsletter-section]').count(), 6)
    assert.equal(await page.locator('[data-newsletter-section="story"] h2').textContent(), issue.topStory.title)
    const company = page.locator('[data-newsletter-section="company"]')
    assert.equal(await company.locator('> table').evaluate(e => getComputedStyle(e).backgroundColor), 'rgb(237, 249, 244)')
    assert.equal(await company.locator('img').evaluate(e => e.getBoundingClientRect().width), 56)
    assert.equal(await page.getByRole('link', { name: issue.facts[0].content, exact: true }).getAttribute('href'), 'https://publisher.example.test/reviewed-source')
    await page.getByRole('link', { name: 'Manage subscription', exact: true }).waitFor()
    for (const width of [640, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 })
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'newsletter overflow at ' + width)
      const callouts = await page.locator('[data-newsletter-section="facts"] li').evaluateAll(items => items.map(item => getComputedStyle(item).borderLeftWidth))
      assert.deepEqual(callouts, issue.facts.map(() => '2px'))
      await page.screenshot({ path: output + '/saved-' + width + '.png', fullPage: true })
    }
    assert.deepEqual(errors, [])
    console.log('Weekly formatting checks passed: styled story, company/logo card, facts, edited source, directory, custom copy and subscription footer at 320–640px' + (base ? '; real saved edition and preview verified.' : '.'))
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
