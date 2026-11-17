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
        await page.locator('.briefing__lead-image img').evaluate(image => image.decode())
        const dimensions = await page.evaluate(() => {
          const rect = selector => document.querySelector(selector).getBoundingClientRect()
          const image = rect('.briefing__lead-image')
          return { hero: rect('.hero').height, analysisTop: rect('.briefing').top,
            imageWidth: image.width, imageHeight: image.height,
            excerptTop: rect('.briefing__excerpt').top, imageBottom: image.bottom }
        })
        assert.ok(dimensions.hero < 320, `${width}px hero should keep the analysis prominent`)
        assert.ok(dimensions.imageWidth <= 240 && dimensions.imageHeight < 180, 'lead image stays compact')
        assert.ok(dimensions.excerptTop >= dimensions.imageBottom, 'lead excerpt clears the image')
        metrics.push({ theme, width, ...dimensions })

        for (const row of await page.locator('.article-row').all()) {
          const image = row.locator('.article-row__thumb img')
          if (await image.count()) {
            await image.scrollIntoViewIfNeeded()
            await image.evaluate(image => image.decode())
            assert.equal(await image.evaluate(image => getComputedStyle(image).objectFit), 'contain', 'cover artwork is not cropped')
          }
          const layout = await row.evaluate(row => {
            const content = row.querySelector('.article-row__excerpt').getBoundingClientRect()
            const heading = row.querySelector('.article-row__heading').getBoundingClientRect()
            return { content: content.toJSON(), heading: heading.toJSON(), card: row.getBoundingClientRect().toJSON() }
          })
          assert.ok(Math.abs(layout.content.width - layout.heading.width) < 1, 'excerpt spans the full width below the heading')
          assert.ok(layout.content.top >= layout.heading.bottom - 1, 'excerpt has no empty thumbnail column beside it')
          assert.ok(layout.content.left >= layout.card.left && layout.content.right <= layout.card.right)
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
    console.log('Reading layout checks passed at 320, 390, 768, 1024 and 1440px in light/dark themes: compact hero/images, full-width excerpts, preserved quotes, native nested list markers, links and no overflow.')
  } finally {
    await browser.close()
  }
})().catch(error => { console.error(error); process.exitCode = 1 })
