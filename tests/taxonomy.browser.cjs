// Build against FIXTURE_SCHEMA=taxonomy before running this production browser check.
const assert = require('node:assert/strict')
const { load } = require('cheerio')
const { chromium } = require('playwright')

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000'
const site = 'https://locreport.com'
const card = '.editorial-home__card'
const report = '/reports/october-2026-localization-industry-report/'

async function request(path) {
  return fetch(base + path, { redirect: 'manual' })
}

async function html(path) {
  const response = await request(path)
  assert.equal(response.status, 200, path)
  return load(await response.text())
}

async function checkStaticRoutes() {
  for (const [from, to] of [
    ['/articles', '/'],
    ['/articles/', '/'],
    ['/page/1/', '/'],
    ['/page/1', '/'],
    ['/articles/platform-announcement', '/briefs/platform-announcement/'],
    ['/articles/combined-analysis/', '/analysis/combined-analysis/'],
    ['/articles/2026/11/15/combined-analysis.html', '/analysis/combined-analysis/'],
    ['/translation/2026/11/15/combined-analysis.html', '/analysis/combined-analysis/'],
    ['/articles/october-2026-localization-industry-report', report],
    ['/reports/monthly/2026/10', report],
    ['/articles/october-2026-industry-intelligence-report-localization-and-translation', report],
  ]) {
    const response = await request(from)
    assert.equal(response.status, 301, from)
    assert.equal(new URL(response.headers.get('location'), base).pathname, to)
    const destination = await request(to)
    assert.equal(destination.status, 200, to)
  }

  const titles = []
  for (const [path, count, next] of [['/', 11, '/page/2/'], ['/page/2/', 12, '/page/3/'], ['/page/3/', 7, null]]) {
    const $ = await html(path)
    const canonical = $('link[rel="canonical"]')
    assert.equal(canonical.length, 1, path)
    assert.equal(canonical.attr('href'), site + path, path)
    assert.equal($(card).length, count, path)
    assert.equal($('a[aria-label="Next Page"]').attr('href') ?? null, next)
    titles.push(...$(card).find('h3').map((_, heading) => $(heading).text()).get())
  }
  assert.equal(new Set(titles).size, titles.length)
  for (const path of ['/page/4/', '/page/01/', '/articles/no-such-article/', '/analysis/no-such-article/']) {
    assert.equal((await request(path)).status, 404, path)
  }
  const wrongType = await request('/briefs/combined-analysis/')
  assert.equal(wrongType.status, 308)
  const destinations = wrongType.headers.get('location').split(',').map(location => new URL(location.trim(), base).pathname)
  assert.deepEqual([...new Set(destinations)], ['/analysis/combined-analysis/'])

  for (const path of ['/briefs/', '/analysis/', '/reports/']) {
    const $ = await html(path)
    assert.equal($('link[rel="canonical"]').attr('href'), site + path)
  }

  for (const [path, section, schema, label, colors] of [
    ['/briefs/platform-announcement/', 'Industry Briefs', 'NewsArticle', 'INDUSTRY BRIEF', /bg-blue-100 text-blue-800/],
    ['/analysis/combined-analysis/', 'Localization Analysis', 'Article', 'LOC ANALYSIS', /bg-purple-100 text-purple-800/],
    [report, 'Industry Reports', 'Article', 'MONTHLY REPORT', /bg-emerald-100 text-emerald-800/],
  ]) {
    const $ = await html(path)
    assert.equal($('link[rel="canonical"]').attr('href'), site + path)
    const objects = $('script[type="application/ld+json"]').map((_, script) => JSON.parse($(script).text())).get()
    const article = objects.find(value => value['@type'] === schema)
    assert.equal(article.articleSection, section)
    assert.equal(article.url, site + path)
    const breadcrumbs = objects.find(value => value['@type'] === 'BreadcrumbList').itemListElement
    assert.equal(breadcrumbs[0].item, site + '/')
    assert.equal(breadcrumbs[1].item, site + '/' + path.split('/')[1] + '/')
    assert.equal($('nav[aria-label="Breadcrumb"] li').length, 3)
    assert.equal($('.article-reading__label .content-badge').text(), label)
    assert.match($('.article-reading__label .content-badge').attr('class'), colors)
  }

  const sitemap = await (await request('/sitemap.xml')).text()
  for (const path of ['/', '/page/2/', '/page/3/', '/briefs/', '/analysis/', '/reports/', report, '/briefs/platform-announcement/']) {
    assert.ok(sitemap.includes(`<loc>${site}${path}</loc>`), path)
  }
  assert.doesNotMatch(sitemap, /<loc>[^<]+\/(?:articles\/|page\/1\/)/)
  const feed = await (await request('/feed.xml')).text()
  assert.match(feed, /<link>https:\/\/locreport\.com\/briefs\/platform-announcement\/<\/link>/)
  assert.match(feed, /<guid isPermaLink="true">https:\/\/locreport\.com\/articles\/platform-announcement<\/guid>/)
}

async function checkEnhancedFeed() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1050 }, reducedMotion: 'reduce' })
    const errors = []
    await page.addInitScript(() => localStorage.setItem('locreport.digest', JSON.stringify({ status: 'dismissed', at: Date.now() })))
    page.on('pageerror', error => errors.push(error.message))
    await page.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort())
    await page.goto(base + '/', { waitUntil: 'networkidle' })
    const pills = page.getByRole('navigation', { name: 'Filter stories' })
    const count = number => page.waitForFunction(({ card, number }) => document.querySelectorAll(card).length === number, { card, number })
    const active = name => page.waitForFunction(name => document.querySelector('.content-filters [aria-current="true"]')?.textContent === name, name)
    for (const [name, label] of [['Briefs', 'INDUSTRY BRIEF'], ['Analysis', 'LOC ANALYSIS'], ['Reports', 'MONTHLY REPORT']]) {
      await pills.getByRole('link', { name, exact: true }).click()
      await active(name)
      assert.equal(page.url(), base + '/')
      const badges = [...new Set(await page.locator('.content-badge').allTextContents())]
      assert.deepEqual(badges, [label])
      if (name === 'Briefs') {
        await page.getByRole('button', { name: 'Load More', exact: true }).click()
        await count(12)
        assert.equal(page.url(), base + '/')
        await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }))
      }
    }
    await pills.getByRole('link', { name: 'All', exact: true }).click()
    await count(11)

    // The normal anchor is intercepted once React has hydrated. No document request is needed.
    const documentRequests = []
    page.on('request', request => { if (request.resourceType() === 'document') documentRequests.push(request.url()) })
    for (const [number, total] of [[2, 23], [3, 30]]) {
      await page.getByRole('link', { name: 'Next Page' }).click()
      await page.waitForURL(base + '/page/' + number + '/')
      await count(total)
      assert.equal(await page.locator('link[rel="canonical"]').getAttribute('href'), site + '/page/' + number + '/')
    }
    await page.goBack()
    await count(23)
    await page.goForward()
    await count(30)
    assert.deepEqual(documentRequests, [])
    assert.deepEqual(errors, [])

    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(base + '/page/2/', { waitUntil: 'networkidle' })
    await count(12)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  } finally {
    await browser.close()
  }
}

;(async () => {
  await checkStaticRoutes()
  await checkEnhancedFeed()
  console.log('Taxonomy smoke checks passed for raw HTML, redirects, structured data, sitemap, filters, and browser history.')
})().catch(error => { console.error(error); process.exitCode = 1 })
