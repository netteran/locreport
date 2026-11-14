// Run against the isolated app/fixture described in docs/research-workflow.md.
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
    const errors = [], writes = []
    let statsFail = false
    page.on('pageerror', e => errors.push({ message: e.message, stack: e.stack, page: page.url() }))
    await page.route('**/api/stats', route => route.fulfill({ status: statsFail ? 503 : 200, json: statsFail ? { error: 'Unavailable' } : { articles: 248, drafts: 6, sources: 32 } }))
    await page.route('**/api/digest/recipients', route => route.fulfill({ json: { subscribers: [{ id: 'one', email: 'editor@example.test' }] } }))
    await page.route('**/api/digest/send*', route => {
      writes.push(route.request().url())
      return route.fulfill({ json: { recipients: 1, skipped: 0, articles: 7 } })
    })
    await page.route('**/api/candidates', route => route.fulfill({ json: { candidates: [], groups: [], events: [], compositions: [] } }))
    await page.route('**/api/sources', route => route.fulfill({ json: [{ id: 'source', name: 'Industry news', url: 'https://example.test/feed', kind: 'feed', active: true, keywords: ['translation'], auto_publish: false, recent_drafts: 2 }] }))
    await page.route('**/api/drafts', route => route.fulfill({ json: [] }))
    await page.route('**/api/scraped-sources', route => route.fulfill({ json: [] }))
    await page.route('**/api/settings', route => route.fulfill({ json: { settings: {} } }))
    await page.goto(base + '/admin', { waitUntil: 'domcontentloaded' })
    await page.getByRole('heading', { name: 'Dashboard', exact: true }).waitFor()
    await page.getByText('248', { exact: true }).waitFor()
    const paths = await page.locator('.admin-tool-link').evaluateAll(links => links.map(link => link.getAttribute('href')))
    assert.equal(paths.length, 12)
    assert.equal(new Set(paths).size, 12)
    const navigationPaths = await page.locator('.admin-nav--desktop a').evaluateAll(links => links.map(link => link.getAttribute('href')))
    assert.deepEqual(new Set(navigationPaths), new Set(['/admin', ...paths]))
    assert.equal(writes.length, 0, 'opening the overview must not run operations')

    const monthly = page.locator('.admin-action').filter({ has: page.getByRole('button', { name: 'Generate monthly report', exact: true }) })
    await monthly.getByRole('button', { name: 'Run', exact: true }).click()
    await monthly.getByRole('button', { name: 'Confirm', exact: true }).waitFor()
    await monthly.getByRole('button', { name: 'Cancel', exact: true }).click()
    const digest = page.locator('.admin-action').filter({ has: page.getByRole('button', { name: 'Send The Weekly', exact: true }) })
    await digest.getByRole('button', { name: 'Preview', exact: true }).click()
    await digest.getByText('This sends real email.', { exact: false }).waitFor()
    assert.equal(writes.length, 1)
    assert.equal(new URL(writes[0]).searchParams.get('dry'), '1', 'preview must never send')
    await digest.getByRole('button', { name: 'Cancel', exact: true }).click()
    await page.locator('.admin-maintenance > summary').click()
    assert.equal(await page.getByRole('button', { name: 'Refresh market quotes', exact: true }).isVisible(), true)
    await page.locator('.admin-maintenance > summary').click()

    fs.mkdirSync('work/admin-preview', { recursive: true })
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({ path: 'work/admin-preview/dashboard-desktop.png', fullPage: true })
    await page.evaluate(() => document.documentElement.dataset.theme = 'dark')
    await page.waitForFunction(() => getComputedStyle(document.body).color === 'rgb(242, 242, 240)')
    await page.screenshot({ path: 'work/admin-preview/dashboard-dark.png', fullPage: true })
    await page.evaluate(() => document.documentElement.dataset.theme = 'light')
    await page.waitForFunction(() => getComputedStyle(document.body).color === 'rgb(23, 24, 28)')
    for (const width of [1440, 900, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 })
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `dashboard overflow at ${width}px`)
    }
    await page.setViewportSize({ width: 390, height: 844 })
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({ path: 'work/admin-preview/dashboard-mobile.png', fullPage: true })
    await page.locator('.admin-nav--mobile > summary').click()
    assert.equal(await page.getByRole('navigation', { name: 'Admin navigation' }).getByRole('link').count(), 13)
    await page.getByRole('navigation', { name: 'Admin navigation' }).getByRole('link', { name: 'Source candidates', exact: true }).click()
    await page.getByRole('heading', { name: 'Source candidates', exact: true }).waitFor()
    assert.equal(await page.locator('.admin-nav--mobile').getAttribute('open'), null, 'mobile navigation closes after route changes')

    // Every top-level tool stays reachable and fits the mobile viewport.
    for (const path of paths) {
      await page.goto(base + path, { waitUntil: 'domcontentloaded' })
      await page.locator('.admin-page h1').waitFor()
      await page.setViewportSize({ width: 1440, height: 1000 })
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${path} overflows desktop viewport`)
      if (['/admin/sources', '/admin/direct', '/admin/directory'].includes(path)) {
        await page.evaluate(() => window.scrollTo(0, 0))
        await page.screenshot({ path: `work/admin-preview/${path.split('/').pop()}-desktop.png`, fullPage: true })
      }
      await page.setViewportSize({ width: 390, height: 844 })
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${path} overflows mobile viewport`)
      await page.locator('.admin-nav--mobile > summary').click()
      assert.equal(await page.getByRole('navigation', { name: 'Admin navigation' }).locator('[aria-current="page"]').getAttribute('href'), path)
    }
    statsFail = true
    await page.goto(base + '/admin', { waitUntil: 'domcontentloaded' })
    await page.getByText('Counts could not be loaded.', { exact: false }).waitFor()
    assert.equal(await page.getByText('Count unavailable', { exact: true }).count(), 3)
    statsFail = false
    await page.getByRole('button', { name: 'Try again', exact: true }).click()
    await page.getByText('248', { exact: true }).waitFor()
    assert.deepEqual(errors, [])
    assert.equal(writes.length, 1, 'no send operation should run')
    console.log('Admin workspace checks passed: all 12 tools, desktop/mobile layout, navigation, confirmations, newsletter preview, stats recovery and no runtime errors.')
  } finally {
    await browser.close()
  }
})().catch(error => { console.error(error); process.exitCode = 1 })
