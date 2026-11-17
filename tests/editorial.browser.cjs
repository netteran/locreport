// Run against the isolated fixture with FIXTURE_SCHEMA=editorial at build and
// runtime. Uses no live database, model API, publishing action or email send.
// TEST_SCHEMA=legacy checks graceful fallback against FIXTURE_SCHEMA=legacy.
const { chromium } = require('playwright')
const assert = require('node:assert/strict')
const fs = require('node:fs')

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000'

;(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } })
    // External fonts, advertising and analytics are irrelevant to these checks.
    await context.route('**/*', route => {
      const host = new URL(route.request().url()).hostname
      return ['127.0.0.1', 'localhost'].includes(host) ? route.continue() : route.abort()
    })
    const page = await context.newPage()
    fs.mkdirSync('work/editorial-preview', { recursive: true })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    page.setDefaultTimeout(20000)

    async function visit(path) {
      const response = await page.goto(base + path, { waitUntil: 'networkidle' })
      assert.equal(response.status(), 200, `${path} should render`)
      return response
    }
    async function noRetiredLinks() {
      assert.equal(await page.locator('a[href^="/intelligence"]').count(), 0)
    }
    async function noOverflow() {
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `horizontal overflow at ${page.url()}`)
    }

    if (process.env.TEST_SCHEMA === 'legacy') {
      for (const path of ['/', '/articles', '/reports/monthly', '/search', '/search?q=Monthly']) {
        await visit(path)
        await noRetiredLinks()
      }
      await page.locator('.search-main a[href="/reports/monthly"]').waitFor()
      assert.deepEqual(errors, [])
      console.log('Legacy editorial browser checks passed: homepage, article archive, monthly briefings and search remain readable when optional coverage columns are missing.')
      return
    }

    await visit('/')
    const navHrefs = await page.locator('#site-menu > li > a, #site-menu > li > .nav-dropdown-trigger > a')
      .evaluateAll(links => links.map(link => link.getAttribute('href')))
    assert.deepEqual(navHrefs, ['/articles', '/fact-flow', '/compass'])
    assert.equal(await page.locator('.briefing__title').innerText(), 'Newest authored analysis', 'latest publication leads even when an older article scores higher')
    assert.equal(await page.locator('.article-row').count(), 4, 'continuous list retains articles spanning more than three publication days')
    assert.ok((await page.locator('.article-row__title').allTextContents()).includes('Older high-impact analysis'))
    assert.equal(await page.locator('.impact-badge, .impact-dot, .briefing__signal-chip, .sidebar-signal').count(), 0)
    await page.getByRole('link', { name: 'A sourced industry announcement.', exact: true }).waitFor()
    await page.getByText('Monthly Briefing · October 2026', { exact: true }).waitFor()
    assert.equal(await page.locator('.home-main a[href="/articles/october-buyer-decisions-briefing"]').count(), 0, 'briefing stays separate from authored industry article list')
    await noRetiredLinks()
    await noOverflow()
    await page.screenshot({ path: 'work/editorial-preview/home-desktop.png', fullPage: true, animations: 'disabled' })

    await page.locator('.site-nav a[href="/compass"]').hover()
    await page.getByRole('menuitem', { name: 'Tech Directory', exact: true }).waitFor({ state: 'visible' })

    await visit('/reports/monthly')
    await page.getByRole('heading', { name: 'Monthly Briefing', exact: true }).waitFor()
    assert.match(await page.locator('.mr-featured-meta').innerText(), /Coverage: October 2026/)
    assert.match(await page.locator('.mr-featured-meta').innerText(), /Published Nov 17, 2026/)
    assert.equal(await page.locator('.mr-featured-signals, .mr-signal-chip').count(), 0)
    await noRetiredLinks()
    await page.screenshot({ path: 'work/editorial-preview/monthly-desktop.png', fullPage: true, animations: 'disabled' })

    await visit('/reports')
    const reportLinks = await page.locator('.reports-list > a').evaluateAll(links => links.map(link => link.getAttribute('href')))
    assert.equal(reportLinks[0], '/reports/monthly')
    await page.getByRole('heading', { name: 'Report archive', exact: true }).waitFor()
    await page.getByText('Archived annual report', { exact: true }).waitFor()

    await visit('/reports/2026-annual-global-market-report')
    assert.match(await page.locator('.all-articles-subtitle').innerText(), /From the report archive · Published April 2026/)
    await page.locator('.all-articles-subtitle a[href="/reports/monthly"]').waitFor()

    for (const path of ['/intelligence', '/intelligence/signals', '/intelligence/signals/quality-gap-closure', '/intelligence/signals/unknown-legacy-signal', '/intelligence/high-impact']) {
      await visit(path)
      assert.equal(new URL(page.url()).pathname, '/intelligence')
      await page.getByRole('heading', { name: /Intelligence and Signals Tracker have been retired/ }).waitFor()
      assert.match(await page.locator('meta[name="robots"]').getAttribute('content'), /noindex/)
      assert.equal(await page.locator('.recharts-wrapper, canvas').count(), 0)
    }
    const sitemap = await context.request.get(base + '/sitemap.xml')
    assert.equal(sitemap.status(), 200)
    assert.doesNotMatch(await sitemap.text(), /<loc>[^<]*\/intelligence/)

    await visit('/search?q=October')
    await page.locator('.search-main a[href="/articles/october-buyer-decisions-briefing"]').waitFor()
    assert.equal(await page.getByText('Signals', { exact: true }).count(), 0)
    await noRetiredLinks()

    await visit('/articles')
    assert.equal(await page.locator('select#impact-filter, select#impact-select').count(), 0)
    await page.getByLabel('Topic', { exact: true }).selectOption('quality')
    await page.waitForURL(/topic=quality/)
    await page.locator('.article-card .article-tag--quality').first().waitFor()
    await page.getByLabel('Category', { exact: true }).selectOption('monthly-summary')
    await page.waitForURL(/category=monthly-summary/)
    await page.waitForFunction(() => document.querySelectorAll('.all-articles-feed > a.article-card').length === 1)
    assert.equal(await page.locator('.all-articles-feed > a.article-card').count(), 1)
    await page.locator('.all-articles-feed a[href="/articles/october-buyer-decisions-briefing"]').waitFor()

    await visit('/articles/newest-authored-analysis')
    await page.getByRole('heading', { name: 'Newest authored analysis', exact: true }).waitFor()
    await page.getByRole('heading', { name: 'Why this matters', exact: true }).waitFor()
    assert.equal(await page.locator('.impact-badge, .time-horizon-badge, .post-intel__signal').count(), 0)
    await noRetiredLinks()

    await visit('/fact-flow')
    await page.getByRole('heading', { name: 'Fact Flow', exact: true }).waitFor()
    await page.getByRole('link', { name: 'A sourced industry announcement.', exact: true }).waitFor()
    assert.equal(await page.getByText('Private pending fact', { exact: true }).count(), 0)

    for (const [path, heading] of [
      ['/compass', 'The Language Services & AI Ecosystem Compass'],
      ['/compass/directory', 'Language Technology Directory'],
      ['/compass/llm-pricing', 'AI Translation Cost Simulator'],
      ['/compass/locstock', 'LocStock'],
    ]) {
      await visit(path)
      await page.getByRole('heading', { name: heading, exact: true }).first().waitFor()
    }

    await page.setViewportSize({ width: 390, height: 844 })
    await visit('/')
    await noOverflow()
    await page.screenshot({ path: 'work/editorial-preview/home-mobile.png', fullPage: true, animations: 'disabled' })
    await page.getByRole('button', { name: 'Open menu', exact: true }).click()
    await page.locator('.site-nav a[href="/articles"]').waitFor({ state: 'visible' })
    await page.locator('.site-nav a[href="/fact-flow"]').click()
    await page.waitForURL(base + '/fact-flow')
    assert.equal(await page.getByRole('button', { name: 'Open menu', exact: true }).getAttribute('aria-expanded'), 'false')
    await noOverflow()
    for (const path of ['/reports/monthly', '/reports', '/intelligence', '/articles/newest-authored-analysis']) {
      await visit(path)
      await noOverflow()
      if (path === '/reports/monthly') await page.screenshot({ path: 'work/editorial-preview/monthly-mobile.png', fullPage: true, animations: 'disabled' })
    }
    assert.deepEqual(errors, [])
    console.log('Editorial browser checks passed: newest article and continuous archive, desktop/mobile navigation, monthly coverage dates, annual archive, retired routes/noindex/sitemap, briefing search, article context, Fact Flow and all Compass tools; no live actions.')
  } finally {
    await browser.close()
  }
})().catch(error => { console.error(error); process.exitCode = 1 })
