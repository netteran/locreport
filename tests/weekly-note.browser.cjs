// Run against the isolated app/fixture described in docs/research-workflow.md.
// Uses the real note API and sample renderer; newsletter sends are intercepted.
const { chromium } = require('playwright')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000'

;(async () => {
  const browser = await chromium.launch({
    headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  })
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } })
    const now = Math.floor(Date.now() / 1000)
    const user = { id: '90000000-0000-4000-8000-000000000001', email: 'editor@example.test', aud: 'authenticated', role: 'authenticated' }
    const token = [
      Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
      Buffer.from(JSON.stringify({ sub: user.id, email: user.email, aud: user.aud, role: user.role, iat: now, exp: now + 3600 })).toString('base64url'),
      'fixture'
    ].join('.')
    await context.addCookies([{
      name: 'sb-127-auth-token', url: base,
      value: 'base64-' + Buffer.from(JSON.stringify({ access_token: token, refresh_token: 'fixture-refresh', expires_at: now + 3600, expires_in: 3600, token_type: 'bearer', user })).toString('base64url')
    }])
    const page = await context.newPage()
    const errors = [], sends = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('**/api/digest/recipients', route => route.fulfill({ json: {
      subscribers: [{ id: '90000000-0000-4000-8000-000000000001', email: 'editor@example.test' }]
    } }))
    await page.route('**/api/digest/send*', route => {
      sends.push(route.request().url())
      assert.equal(new URL(route.request().url()).searchParams.get('dry'), '1', 'test must never send email')
      return route.fulfill({ json: { recipients: 1, skipped: 0, articles: 2 } })
    })
    const unauthorized = await browser.newContext()
    assert.equal((await unauthorized.request.get(base + '/api/digest/note')).status(), 401)
    assert.equal((await unauthorized.request.put(base + '/api/digest/note', { data: { paragraph: 'Unauthorized' } })).status(), 401)
    await unauthorized.close()

    await page.goto(base + '/admin', { waitUntil: 'domcontentloaded' })
    const paragraph = page.getByRole('textbox', { name: 'Opening note' })
    await paragraph.waitFor()
    await page.waitForFunction(() => !document.querySelector('.admin-weekly-note textarea').disabled)
    const copy = '# This week\n\nHello **readers** and *friends*: [**our latest report**](https://example.com/report?a=1&b=2). <b>Literal HTML</b> & thoughts.\n\n## What to watch\n\nA second paragraph.'
    await paragraph.fill(copy)
    const preview = page.getByRole('button', { name: 'Preview', exact: true })
    const sample = page.getByRole('button', { name: 'View sample', exact: true })
    assert.equal(await preview.isDisabled(), true)
    assert.equal(await sample.isDisabled(), true)
    await page.getByRole('button', { name: 'Save note', exact: true }).click()
    await page.getByText('Note saved for this edition.', { exact: true }).waitFor()
    assert.equal((await (await context.request.get(base + '/api/digest/note')).json()).paragraph, copy)
    assert.equal(sends.length, 0, 'saving must never send')

    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForFunction(expected => document.querySelector('.admin-weekly-note textarea')?.value === expected, copy)
    const [popup] = await Promise.all([page.waitForEvent('popup'), sample.click()])
    await popup.waitForLoadState('domcontentloaded')
    await popup.getByText('Hello readers and friends: our latest report. <b>Literal HTML</b> & thoughts.', { exact: true }).waitFor()
    assert.equal(await popup.locator('p strong').first().textContent(), 'readers')
    assert.equal(await popup.locator('p em').first().textContent(), 'friends')
    assert.equal(await popup.getByRole('link', { name: 'our latest report', exact: true }).getAttribute('href'), 'https://example.com/report?a=1&b=2')
    await popup.getByRole('heading', { name: 'This week', level: 1, exact: true }).waitFor()
    await popup.getByRole('heading', { name: 'What to watch', level: 2, exact: true }).waitFor()
    await popup.getByText('A second paragraph.', { exact: true }).waitFor()
    assert.equal(await popup.locator('p h1, p h2').count(), 0)
    const html = await popup.content()
    assert.ok(html.includes('&lt;b&gt;Literal HTML&lt;/b&gt; &amp; thoughts'))
    assert.equal(await popup.locator('b').count(), 0)
    await popup.close()
    await preview.click()
    await page.getByText('This sends real email.', { exact: false }).waitFor()
    await paragraph.fill('Revised copy for this edition.')
    assert.equal(await page.getByText('This sends real email.', { exact: false }).count(), 0, 'editing clears prior confirmation')

    await page.route('**/api/digest/note', route => route.request().method() === 'PUT'
      ? route.fulfill({ status: 503, json: { error: 'Test save failure' } }) : route.continue())
    await page.getByRole('button', { name: 'Save note', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: 'Test save failure' }).waitFor()
    assert.equal(await preview.isDisabled(), true)
    assert.equal((await (await context.request.get(base + '/api/digest/note')).json()).paragraph, copy)
    await page.unroute('**/api/digest/note')
    await page.getByRole('button', { name: 'Save note', exact: true }).click()
    await page.getByText('Note saved for this edition.', { exact: true }).waitFor()
    fs.mkdirSync('work/weekly-note-preview', { recursive: true })
    await page.locator('.admin-weekly-note').screenshot({ path: 'work/weekly-note-preview/desktop.png' })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.locator('.admin-weekly-note').screenshot({ path: 'work/weekly-note-preview/mobile.png' })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await paragraph.fill('')
    await page.getByRole('button', { name: 'Save note', exact: true }).click()
    await page.getByText('Note removed from this edition.', { exact: true }).waitFor()
    const sampleResponse = await context.request.get(base + '/api/digest/preview')
    assert.equal(sampleResponse.status(), 200)
    assert.ok(!(await sampleResponse.text()).includes('Revised copy for this edition.'))
    assert.equal(sends.length, 1, 'only the explicit dry-run preview should run')
    assert.deepEqual(errors, [])
    console.log('Weekly paragraph browser checks passed: authentication, save/reload, formatted sample HTML with headings/bold/italics/links, unsaved-change protection, confirmation reset, save failure/retry, clearing and mobile layout; no email sent.')
  } finally {
    await browser.close()
  }
})().catch(error => { console.error(error); process.exitCode = 1 })
