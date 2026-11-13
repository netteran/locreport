// Run against the isolated app/fixture described in docs/research-workflow.md.
const { chromium } = require('playwright')
const assert = require('node:assert/strict')
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000'
const ids = ['30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002']
const compId = '40000000-0000-4000-8000-000000000001',
  draftId = '50000000-0000-4000-8000-000000000001'
const candidates = ids.map((id, i) => ({
  id,
  title: `Evidence source ${i + 1}`,
  source_url: `https://source${i + 1}.example.test/news`,
  source_name: `Publisher ${i + 1}`,
  source_feed_id: null,
  source_published_at: '2026-11-13T09:00:00Z',
  extracted_facts: `Specific sourced evidence ${i + 1}`,
  quality: 'full',
  topics: ['Enterprise interpreting'],
  entities: ['provider'],
  status: 'available',
  processing_status: 'ready',
  review_reason: null,
  event_id: null,
  suggested_event_id: null,
  reserved_by: null,
  created_at: '2026-11-13T09:05:00Z'
}))
;(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  })
  try {
    const context = await browser.newContext()
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    // A cron bearer alone must never authorize generation/publication.
    for (const path of [`/api/compositions/${compId}/generate`, `/api/drafts/${draftId}`]) {
      const r = await context.request.fetch(base + path, {
        method: path.endsWith('generate') ? 'POST' : 'PATCH',
        headers: { Authorization: 'Bearer fixture-cron' },
        data: { status: 'approved' }
      })
      assert.equal(r.status(), 401)
    }
    const now = Math.floor(Date.now() / 1000)
    const user = {
      id: '90000000-0000-4000-8000-000000000001',
      email: 'editor@example.test',
      aud: 'authenticated',
      role: 'authenticated'
    }
    const token = [
      Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
      Buffer.from(
        JSON.stringify({
          sub: user.id,
          email: user.email,
          aud: 'authenticated',
          role: 'authenticated',
          iat: now,
          exp: now + 3600
        })
      ).toString('base64url'),
      'fixture'
    ].join('.')
    const session = {
      access_token: token,
      refresh_token: 'fixture-refresh',
      expires_at: now + 3600,
      expires_in: 3600,
      token_type: 'bearer',
      user
    }
    await context.addCookies([
      {
        name: 'sb-127-auth-token',
        value: 'base64-' + Buffer.from(JSON.stringify(session)).toString('base64url'),
        url: base
      }
    ])
    if (process.env.TEST_SCHEMA === 'legacy') {
      for (const [path, method] of [
        ['/api/candidates', 'GET'],
        [`/api/compositions/${compId}/generate`, 'POST'],
        [`/api/drafts/${draftId}`, 'PATCH']
      ]) {
        const response = await context.request.fetch(base + path, {
          method,
          data: method === 'GET' ? undefined : { status: 'approved' }
        })
        assert.equal(response.status(), 503)
        assert.match((await response.json()).error, /20261113_research_publications.sql/)
      }
      const processing = await context.request.post(base + '/api/research/process', {
        headers: { Authorization: 'Bearer fixture-cron' },
        data: {}
      })
      assert.equal(processing.status(), 503)
      await page.goto(base + '/fact-flow')
      await page
        .getByRole('link', { name: 'A sourced industry announcement.', exact: true })
        .waitFor()
      assert.equal(await page.getByText('Private pending fact', { exact: true }).count(), 0)
      await page
        .getByRole('link', { name: 'LocReport analysis: Combined analysis →', exact: true })
        .waitFor()
      const rss = await context.request.get(base + '/fact-flow/feed.xml')
      assert.equal(rss.status(), 200)
      const xml = await rss.text()
      assert.match(xml, /A sourced industry announcement/)
      assert.doesNotMatch(xml, /Private pending fact/)
      await page.goto(base + '/')
      await page
        .getByRole('link', { name: 'A sourced industry announcement.', exact: true })
        .waitFor()
      assert.equal(errors.length, 0, errors.join('\n'))
      console.log(
        'Legacy schema browser checks passed: public news/homepage/RSS remain readable; research and publishing return migration-required 503.'
      )
      return
    }
    let generationCalls = 0,
      savedBrief = null
    const composition = {
      id: compId,
      title: 'Working analysis',
      angle: '',
      personal_experience: '',
      target_words: 1400,
      status: 'editing',
      draft_id: null,
      last_error: null,
      composition_sources: candidates.map((snapshot, i) => ({
        candidate_id: snapshot.id,
        snapshot,
        covered: false,
        position: i
      }))
    }
    await page.route('**/api/candidates', (route) =>
      route.fulfill({
        json: {
          candidates,
          groups: [
            {
              id: 'group',
              title: 'A coherent article',
              question: 'What should enterprise buyers verify?',
              rationale: 'Two complementary sources',
              candidate_ids: ids
            }
          ],
          events: [],
          compositions: []
        }
      })
    )
    await page.route('**/api/compositions', (route) =>
      route.fulfill({ status: 201, json: { id: compId } })
    )
    await page.route(`**/api/compositions/${compId}`, async (route) => {
      if (route.request().method() === 'PATCH') savedBrief = route.request().postDataJSON()
      await route.fulfill({ json: composition })
    })
    await page.route(`**/api/compositions/${compId}/generate`, (route) => {
      generationCalls++
      return route.fulfill({ json: { draft_id: draftId } })
    })
    await page.route(`**/api/drafts/${draftId}`, (route) =>
      route.fulfill({
        json: {
          id: draftId,
          title: 'Combined analysis',
          content: '# Combined analysis\n\nA sourced article.',
          source_url: null,
          status: 'pending',
          composition_id: compId,
          created_at: '2026-11-13T09:00:00Z',
          extracted_facts: 'Pinned evidence',
          fact: null
        }
      })
    )
    await page.goto(base + '/admin/candidates')
    await page.getByRole('heading', { name: 'Source candidates', exact: true }).waitFor()
    await page.getByRole('checkbox', { name: 'Select Evidence source 1' }).check()
    await page.getByRole('checkbox', { name: 'Select Evidence source 2' }).check()
    await page.getByRole('button', { name: 'Combine selected' }).click()
    await page.getByRole('heading', { name: 'Combine sources', exact: true }).waitFor()
    assert.equal(generationCalls, 0)
    await page
      .getByLabel('Central question and editorial direction')
      .fill('Explain integration trade-offs for enterprise buyers.')
    await page
      .getByLabel('Your personal experience')
      .fill(
        'In my own projects, workflow integration took more effort than the translation engine setup.'
      )
    await page.getByRole('button', { name: 'Save brief', exact: true }).click()
    await page.getByText('Brief saved', { exact: true }).waitFor()
    assert.equal(generationCalls, 0)
    assert.match(savedBrief.personal_experience, /my own projects/)
    await page.getByRole('button', { name: 'Generate draft', exact: true }).click()
    await page.waitForURL(`**/admin/drafts/${draftId}`)
    assert.equal(generationCalls, 1)
    assert.equal(await page.locator('.digest-popup__overlay').count(), 0)
    await page.getByRole('button', { name: 'Approve & publish', exact: true }).waitFor()
    assert.equal(await page.locator('#edit-fact').count(), 0)
    // Public wire entries use original sources, stable anchors, evidence and analysis links.
    await page.goto(base + '/fact-flow')
    await page
      .getByRole('link', { name: 'A sourced industry announcement.', exact: true })
      .waitFor()
    assert.equal(
      await page
        .getByRole('link', { name: 'A sourced industry announcement.', exact: true })
        .getAttribute('href'),
      'https://example.test/announcement'
    )
    await page.getByText('2 supporting sources', { exact: true }).click()
    await page.getByRole('link', { name: 'Industry publication ↗', exact: true }).waitFor()
    await page
      .getByRole('link', { name: 'LocReport analysis: Combined analysis →', exact: true })
      .waitFor()
    assert.equal(errors.length, 0, errors.join('\n'))
    console.log(
      'Browser checks passed: manual selection, brief, explicit generation, manual publication boundary, sourced Fact Flow.'
    )
    await context.close()
  } finally {
    await browser.close()
  }
})().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
