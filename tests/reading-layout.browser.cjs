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
      await context.route(/^https:\/\/pagead2\.googlesyndication\.com\/pagead\/js\/adsbygoogle\.js/, route =>
        route.fulfill({ contentType: 'application/javascript', body: 'window.adsbygoogle ||= []' }))
      const page = await context.newPage()
      await page.addInitScript(() => localStorage.setItem('locreport.digest', JSON.stringify({ status: 'dismissed', at: Date.now() })))
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
        assert.equal(await page.locator('.home-logo-ticker + .advertise-banner').count(), 1, 'the advertise banner follows the logo ticker')
        assert.equal(await page.locator('[data-ad-placement="home-briefing"], [data-ad-placement="home-feed"]').count(), 0)
        const storiesAd = page.locator('.editorial-home__analysis-grid > .editorial-home__grid-ad')
        assert.equal(await storiesAd.count(), 1, 'one AdSense unit sits inside the stories grid')
        const adUnit = storiesAd.locator('ins.adsbygoogle')
        await adUnit.evaluate(ad => {
          ad.dataset.adStatus = 'filled'
          ad.style.height = '112px'
        })
        const dimensions = await page.evaluate(() => {
          const rect = selector => document.querySelector(selector).getBoundingClientRect()
          const lead = rect('.editorial-home__lead')
          const flow = rect('.editorial-home__fact-flow')
          const image = rect('.editorial-home__image')
          const headline = rect('.editorial-home__lead h1')
          const summary = rect('.editorial-home__summary')
          const leadStyle = getComputedStyle(document.querySelector('.editorial-home__lead'))
          const summaryStyle = getComputedStyle(document.querySelector('.editorial-home__summary'))
          const photo = rect('.editorial-home__image img')
          const ad = rect('.advertise-banner')
          const logos = rect('.home-logo-ticker')
          const cards = [...document.querySelectorAll('.editorial-home__card')].map(card => card.getBoundingClientRect())
          const columns = new Set(cards.map(card => Math.round(card.left))).size
          const storiesAd = rect('.editorial-home__grid-ad')
          const storiesAdUnit = rect('.editorial-home__grid-ad .home-ad-reservation')
          const grid = rect('.editorial-home__analysis-grid')
          const above = cards.filter(card => card.bottom <= storiesAd.top + 1).length
          const logoTrack = document.querySelector('.home-logo-ticker__track')
          return {
            beside: flow.left >= lead.right && Math.abs(flow.top - lead.top) < 1,
            stacked: flow.top >= lead.bottom,
            cardsEndTogether: Math.abs(flow.bottom - lead.bottom) < 1,
            adBelowLogos: ad.top >= logos.bottom,
            adCentered: Math.abs(ad.left + ad.right - document.documentElement.clientWidth) < 1,
            storiesAdAfterTwoRows: above === Math.min(cards.length, columns * 2),
            storiesAdOriginalWidth: storiesAdUnit.width <= 728.5
              && Math.abs(storiesAdUnit.width - Math.min(728, grid.width)) < 1
              && Math.abs((storiesAdUnit.left - grid.left) - (grid.right - storiesAdUnit.right)) < 1,
            logosBelowCards: logos.top >= Math.max(flow.bottom, lead.bottom),
            logosFillPage: Math.abs(logos.left - lead.left) < 1 && Math.abs(logos.right - Math.max(lead.right, flow.right)) < 1,
            logosRespectReducedMotion: getComputedStyle(logoTrack).animationName === 'none',
            mobileImageOrder: image.top >= headline.bottom && image.bottom <= summary.top,
            imageFillsColumn: Math.abs(image.top - lead.top - parseFloat(leadStyle.paddingTop) - parseFloat(leadStyle.borderTopWidth)) < 1
              && Math.abs(lead.bottom - image.bottom - parseFloat(leadStyle.paddingBottom) - parseFloat(leadStyle.borderBottomWidth)) < 1
              && Math.abs(photo.height - image.height) < 1,
            summaryFitsFourLines: summary.height <= parseFloat(summaryStyle.lineHeight) * 4 + 1,
            imageWidth: image.width,
            imageHeight: image.height,
          }
        })
        assert.equal(dimensions.beside, width >= 1024, 'Fact Flow is beside the lead on wide screens')
        assert.equal(dimensions.stacked, width < 1024, 'Fact Flow follows the lead on smaller screens')
        if (width >= 1024) assert.ok(dimensions.cardsEndTogether, 'the featured article and Fact Flow end together')
        assert.ok(dimensions.logosBelowCards && dimensions.logosFillPage, 'the logo ticker spans the main container below both cards')
        assert.ok(dimensions.adBelowLogos && dimensions.adCentered, 'the advertise banner is centered below the logo ticker')
        assert.ok(dimensions.storiesAdAfterTwoRows, 'the AdSense unit follows the second row of stories')
        assert.ok(dimensions.storiesAdOriginalWidth, 'the AdSense unit keeps its original width, centred in the grid')
        assert.ok(dimensions.logosRespectReducedMotion, 'the ticker honors reduced motion')
        if (width <= 690) assert.ok(dimensions.mobileImageOrder, 'the mobile lead image sits between the headline and summary')
        else assert.ok(dimensions.imageFillsColumn, 'the lead image fills its side from top to bottom')
        assert.ok(dimensions.summaryFitsFourLines, 'homepage summary uses a compact teaser')
        metrics.push({ theme, width, ...dimensions })

        for (const card of await page.locator('.editorial-home__card').all()) {
          const image = card.locator('.editorial-home__card-image img')
          if (await image.count()) {
            await image.scrollIntoViewIfNeeded()
            await image.evaluate(async image => {
              image.loading = 'eager'
              await image.decode()
            })
            const photo = await image.boundingBox()
            const copy = await card.locator('.editorial-home__card-copy').boundingBox()
            assert.ok(Math.abs(photo.width / photo.height - 16 / 9) < 0.02, 'card image uses a 16:9 crop')
            assert.ok(copy.y >= photo.y + photo.height - 1, 'card copy sits below its image')
          }
        }
        await noOverflow()
        if ([1440, 390].includes(width)) {
          await adUnit.evaluate(ad => { ad.dataset.adStatus = 'unfilled' })
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
          const emptySlot = await storiesAd.evaluate(slot => ({
            height: slot.getBoundingClientRect().height,
            width: slot.getBoundingClientRect().width,
            rowGap: parseFloat(getComputedStyle(slot.parentElement).rowGap),
            // Largest vertical gap between consecutive rows of story cards.
            gap: (() => {
              const rows = [...document.querySelectorAll('.editorial-home__card')]
                .map(card => card.getBoundingClientRect())
                .sort((a, b) => a.top - b.top)
              let widest = 0
              for (let i = 1; i < rows.length; i++) {
                const above = Math.max(...rows.slice(0, i).map(row => row.bottom))
                if (rows[i].top > above) widest = Math.max(widest, rows[i].top - above)
              }
              return widest
            })(),
          }))
          assert.equal(emptySlot.height, 0, 'an unfilled ad takes up no height')
          assert.ok(emptySlot.width > 0, 'the hidden ad still has measurable width')
          assert.ok(emptySlot.gap <= emptySlot.rowGap + 1, `an unfilled ad leaves no extra gap between rows (${emptySlot.gap}px)`)
          assert.equal(await adUnit.getAttribute('data-ad-status'), 'unfilled')
          await page.evaluate(() => scrollTo(0, 0))
          await page.screenshot({ path: `${previews}/home-${theme}-${width}.png`, fullPage: true, animations: 'disabled' })
        }

        await visit('/analysis/newest-authored-analysis/')
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
      await page.emulateMedia({ reducedMotion: 'no-preference' })
      await visit('/')
      const ticker = page.locator('.home-logo-ticker')
      assert.equal(await ticker.locator('button').count(), 0, 'the marquee needs no controls')
      const groups = await ticker.locator('.home-logo-ticker__group').allTextContents()
      assert.equal(groups.length, 2)
      assert.equal(groups[0], groups[1], 'the two logo groups make the loop seamless')
      await page.waitForFunction(() => {
        const track = document.querySelector('.home-logo-ticker__track')
        const animation = track?.getAnimations()[0]
        return animation?.effect?.getTiming().iterations === Infinity
          && animation.playState === 'running'
          && animation.currentTime > 100
      })
      const readerPalette = await page.locator('.public-shell').evaluate(shell => getComputedStyle(shell).backgroundColor)
      const homeColors = await page.evaluate(() => {
        const color = (selector, property) => getComputedStyle(document.querySelector(selector))[property]
        return {
          factPanel: color('.editorial-home__fact-flow', 'backgroundColor'),
          factMessage: color('.editorial-home__updates li', 'backgroundColor'),
          weekly: color('.editorial-home__weekly', 'backgroundColor'),
          weeklyBorder: color('.editorial-home__weekly', 'borderTopWidth'),
          weeklyHeading: color('.editorial-home__weekly h2', 'color'),
          footerSpacing: color('.site-footer', 'marginTop'),
        }
      })
      assert.notEqual(homeColors.factPanel, readerPalette, 'the Fact Flow panel keeps its warm surface')
      assert.equal(homeColors.factMessage, 'rgba(0, 0, 0, 0)', 'updates sit on the panel, separated by hairlines')
      assert.equal(homeColors.weekly, 'rgba(0, 0, 0, 0)', 'the signup sits on plain paper')
      assert.equal(homeColors.weeklyBorder, '1px', 'hairlines frame the signup')
      assert.equal(homeColors.footerSpacing, '0px', 'the footer follows the homepage without an extra spacer')

      for (const path of ['/reports', '/fact-flow', '/directory', '/directory/rws', '/locstock', '/llm-pricing']) {
        for (const width of [1440, 390]) {
          await page.setViewportSize({ width, height: 900 })
          await visit(path)
          assert.equal(await page.locator('.public-shell').evaluate(shell => getComputedStyle(shell).backgroundColor), readerPalette)
          assert.match(await page.locator('h1').first().evaluate(heading => getComputedStyle(heading).fontFamily), /Manrope/)
          await noOverflow()
        }
      }
      await visit('/fact-flow')
      const entry = await page.locator('.ff-entry .ff-body').first().evaluate(body => ({
        rule: getComputedStyle(body).borderLeftWidth,
        dot: getComputedStyle(body, '::before').backgroundColor,
      }))
      assert.equal(entry.rule, '1px', 'Fact Flow entries hang on a timeline rule')
      assert.notEqual(entry.dot, readerPalette, 'each Fact Flow entry carries its own dot')
      await context.close()
    }
    assert.deepEqual(errors, [])
    fs.writeFileSync(`${previews}/metrics.json`, JSON.stringify(metrics, null, 2))
    console.log('Reading layout checks passed at 320, 390, 768, 1024 and 1440px in light/dark themes: responsive lead imagery, continuous logo ticker, shared page styling, preserved quotes, native nested list markers, links and no overflow.')
  } finally {
    await browser.close()
  }
})().catch(error => { console.error(error); process.exitCode = 1 })
