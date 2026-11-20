// Run against an isolated app with FIXTURE_SCHEMA=editorial. No live services.
const { chromium } = require('playwright')
const assert = require('node:assert/strict')
const fs = require('node:fs')

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000'
const previews = 'work/reading-preview'

;(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })
  fs.mkdirSync(previews, { recursive: true })
  const errors = []
  const metrics = []
  try {
    for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({ colorScheme: theme, reducedMotion: 'reduce' })
      await context.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname)
        ? route.continue() : route.abort())
      const page = await context.newPage()
      page.setDefaultTimeout(20000)
      page.on('pageerror', error => errors.push(error.message))

      async function visit(path) {
        const response = await page.goto(base + path, { waitUntil: 'networkidle' })
        assert.equal(response.status(), 200)
        assert.equal(await page.locator('html').getAttribute('data-theme'), theme)
      }
      async function noOverflow() {
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${theme}: ${page.url()} overflows`)
      }

      for (const width of [1440, 1024, 768, 390, 320]) {
        await page.setViewportSize({ width, height: width > 768 ? 1000 : 844 })
        await visit('/')
        await page.locator('.editorial-home__image img').evaluate(image => image.decode())
        const dimensions = await page.evaluate(() => {
          const rect = selector => document.querySelector(selector).getBoundingClientRect()
          const lead = rect('.editorial-home__lead')
          const flow = rect('.editorial-home__fact-flow')
          const image = rect('.editorial-home__image')
          const headline = rect('.editorial-home__lead h1')
          const summary = rect('.editorial-home__summary')
          const sources = rect('.home-sources')
          return {
            beside: flow.left >= lead.right && Math.abs(flow.top - lead.top) < 1,
            stacked: flow.top >= lead.bottom,
            sourcesBelow: sources.top >= Math.max(lead.bottom, flow.bottom),
            mobileImageOrder: image.top >= headline.bottom && image.bottom <= summary.top,
            imageWidth: image.width,
            imageHeight: image.height,
          }
        })
        assert.equal(dimensions.beside, width >= 1024, 'Fact Flow is beside the lead on wide screens')
        assert.equal(dimensions.stacked, width < 1024, 'Fact Flow follows the lead on smaller screens')
        assert.ok(dimensions.sourcesBelow, 'the Sources strip follows the lead and Fact Flow')
        if (width <= 690) assert.ok(dimensions.mobileImageOrder, 'the mobile lead image sits between the headline and summary')
        metrics.push({ theme, width, ...dimensions })

        for (const card of await page.locator('.editorial-home__card').all()) {
          const image = card.locator('.editorial-home__card-image img')
          if (await image.count()) {
            await image.scrollIntoViewIfNeeded()
            await image.evaluate(image => image.decode())
            const photo = await image.boundingBox()
            const copy = await card.locator('.editorial-home__card-copy').boundingBox()
            assert.ok(Math.abs(photo.width / photo.height - 16 / 9) < 0.02, 'card image uses a 16:9 crop')
            assert.ok(copy.y >= photo.y + photo.height - 1, 'card copy sits below its image')
          }
        }
        await noOverflow()
        if ([1440, 390].includes(width)) {
          await page.evaluate(() => scrollTo(0, 0))
          await page.screenshot({ path: `${previews}/home-${theme}-${width}.png`, fullPage: true, animations: 'disabled' })
        }

        await visit('/articles/newest-authored-analysis')
        const content = page.locator('.post-content')
        assert.equal(await content.locator('blockquote').count(), 2, 'opening and body quotations must both survive rendering')
        await content.getByText('Language expertise becomes useful when it informs the whole decision, not just the translation.', { exact: true }).waitFor()
        await content.getByText('A second paragraph should feel like part of the same quotation.', { exact: true }).waitFor()
        const listStyle = selector => content.locator(selector).first().evaluate(list => getComputedStyle(list).listStyleType)
        assert.equal(await listStyle('ul'), 'disc')
        assert.equal(await listStyle('ul ul'), 'circle')
        assert.equal(await listStyle('ol'), 'decimal')
        assert.equal(await listStyle('ol ol'), 'lower-alpha')
        for (const item of await content.locator('li, blockquote').all()) {
          const box = await item.boundingBox()
          assert.ok(box.x >= 0 && box.x + box.width <= width, 'quotation and list text remain inside the viewport')
        }
        const looseParagraph = content.locator('li p').first()
        assert.ok(await looseParagraph.evaluate(p => parseFloat(getComputedStyle(p).marginBottom) < parseFloat(getComputedStyle(p).lineHeight)), 'paragraphs inside list items keep a compact rhythm')
        const external = content.getByRole('link', { name: 'supporting material', exact: true })
        assert.equal(await external.getAttribute('href'), 'https://example.test/evidence')
        assert.equal(await external.getAttribute('target'), '_blank')
        await noOverflow()
        if ([1440, 390].includes(width)) {
          await content.screenshot({ path: `${previews}/article-${theme}-${width}.png`, animations: 'disabled',
            style: '.site-header, .back-to-top, .digest-launcher, nextjs-portal { visibility: hidden !important; }' })
        }
      }
      await context.close()
    }
    assert.deepEqual(errors, [])
    fs.writeFileSync(`${previews}/metrics.json`, JSON.stringify(metrics, null, 2))
    console.log('Reading layout checks passed at 320, 390, 768, 1024 and 1440px in light/dark themes: responsive lead and article imagery, preserved quotes, native nested list markers, links and no overflow.')
  } finally {
    await browser.close()
  }
})().catch(error => { console.error(error); process.exitCode = 1 })
