// Run against the isolated research-schema app/fixture in docs/research-workflow.md.
const { chromium } = require('playwright')
const assert = require('node:assert/strict')
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000'
const ids = [1, 2, 3].map(n => `70000000-0000-4000-8000-${String(n).padStart(12, '0')}`)

;(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  })
  try {
    const context = await browser.newContext()
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
    const errors = [], articleWrites = []
    page.on('pageerror', e => errors.push(e.message))
    page.on('request', request => {
      if (request.method() !== 'GET' && /\/api\/(compositions|drafts|monthly-report)/.test(request.url())) {
        articleWrites.push(request.url())
      }
    })

    // Exercise the real processing route's authentication, validation and empty queue.
    const unauthorized = await browser.newContext()
    assert.equal((await unauthorized.request.post(base + '/api/research/process', { data: {} })).status(), 401)
    await unauthorized.close()
    const invalid = await context.request.post(base + '/api/research/process', { data: { source_ids: ['invalid'] } })
    assert.equal(invalid.status(), 400)
    const empty = await context.request.post(base + '/api/research/process', { data: { source_ids: [ids[0]] } })
    assert.equal(empty.status(), 200)
    assert.deepEqual(await empty.json(), { action: 'idle', processed: 0, errors: [] })

    let calls = [], batches = 0, podcastSteps = 0, mode = 'normal'
    function reset(nextMode = 'normal') { calls = []; batches = 0; podcastSteps = 0; mode = nextMode }
    await page.route('**/api/stats', route => route.fulfill({ json: { articles: 1, drafts: 0, sources: 3 } }))
    await page.route('**/api/digest/recipients', route => route.fulfill({ json: { subscribers: [] } }))
    await page.route('**/api/sources', route => route.fulfill({ json: ids.map((id, i) => ({
      id, name: i === 2 ? 'Trusted podcast' : `RSS publisher ${i + 1}`,
      url: `https://publisher${i + 1}.example.test/feed`, active: true,
      kind: i === 2 ? 'podcast' : 'feed', keywords: [], auto_publish: i !== 1,
      auto_collect: true, recent_drafts: 0,
      podcast_config: i === 2 ? { ignore_before: '2026-11-01' } : null
    })) }))
    await page.route('**/api/candidates', route => route.fulfill({ json: { candidates: [], groups: [], events: [], compositions: [] } }))
    await page.route('**/api/ingest*', route => {
      calls.push({ path: '/api/ingest', sources: new URL(route.request().url()).searchParams.get('sources') })
      return route.fulfill({ json: { processed: mode === 'quiet' ? 0 : 2, skipped: 0, errors: [] } })
    })
    await page.route('**/api/podcasts/auto*', route => {
      calls.push({ path: '/api/podcasts/auto', source: new URL(route.request().url()).searchParams.get('id') })
      return route.fulfill({ json: ++podcastSteps === 1 ? { action: 'notes', candidate_id: 'saved' } : { action: 'idle' } })
    })
    await page.route('**/api/research/process', route => {
      const body = route.request().postDataJSON()
      calls.push({ path: '/api/research/process', body })
      if (mode === 'blocked') return route.fulfill({ status: 503, json: { error: 'Apply migration 20261113_research_publications.sql' } })
      return route.fulfill({ json: body.stage === 'groups' ? { ok: true } : {
        action: ++batches === 1 ? 'processed' : 'idle', processed: 1, errors: []
      } })
    })
    const complete = /Fact Flow processing complete; article suggestions refreshed\./

    // Dashboard manual ingest must not finish after collection alone.
    await page.goto(base + '/admin')
    const ingestRow = page.locator('.admin-action').filter({ has: page.getByRole('button', { name: 'Run ingest', exact: true }) })
    await ingestRow.getByRole('button', { name: 'Run', exact: true }).click()
    await ingestRow.getByRole('button', { name: 'Confirm', exact: true }).click()
    await ingestRow.getByText(complete).waitFor()
    assert.deepEqual(calls.map(c => c.path), ['/api/ingest', '/api/research/process', '/api/research/process', '/api/research/process'])
    assert.deepEqual(calls.slice(1).map(c => c.body), [{}, {}, { stage: 'groups' }])
    assert.equal(await ingestRow.getByText(/drafts? created/).count(), 0)

    // Individual RSS source and batch buttons run the same stages with their source scope.
    reset()
    await page.goto(base + '/admin/sources')
    const rssRow = page.getByRole('row').filter({ hasText: 'RSS publisher 1' })
    await rssRow.getByRole('button', { name: 'Ingest', exact: true }).click()
    await rssRow.getByText(complete).waitFor()
    assert.equal(calls[0].sources, ids[0])
    assert.deepEqual(calls[1].body, { source_ids: [ids[0]] })
    assert.deepEqual(calls.at(-1).body, { stage: 'groups' })

    reset('quiet')
    await page.getByRole('combobox', { name: 'Batch', exact: true }).selectOption('1')
    await page.getByRole('button', { name: 'Ingest batch 1', exact: true }).click()
    await page.getByText('0 fresh items', { exact: true }).waitFor()
    await page.waitForFunction(() => document.querySelectorAll('[role="status"]').length >= 2)
    assert.equal(calls[0].sources, ids.slice(0, 2).join(','))
    assert.deepEqual(calls[1].body, { source_ids: ids.slice(0, 2) })
    assert.deepEqual(calls.at(-1).body, { stage: 'groups' })

    reset()
    await page.getByRole('combobox', { name: 'Batch', exact: true }).selectOption('all')
    const podcastRow = page.getByRole('row').filter({ hasText: 'Trusted podcast' })
    await podcastRow.getByRole('button', { name: 'Ingest', exact: true }).click()
    await podcastRow.getByRole('button', { name: 'Yes', exact: true }).click()
    await podcastRow.getByText(complete).waitFor()
    assert.equal(calls[0].source, ids[2])
    assert.equal(calls[1].path, '/api/podcasts/auto')
    assert.deepEqual(calls[2].body, { source_ids: [ids[2]] })
    assert.deepEqual(calls.at(-1).body, { stage: 'groups' })

    // Resume already collected candidates without any collection request.
    reset()
    await page.goto(base + '/admin/candidates')
    await page.getByRole('button', { name: 'Process facts and suggestions', exact: true }).click()
    await page.getByText(complete).waitFor()
    assert.equal(calls.length, 3)
    assert.ok(calls.every(c => c.path === '/api/research/process'))

    reset()
    await page.getByRole('button', { name: 'Suggested articles', exact: true }).click()
    await page.getByRole('button', { name: 'Refresh suggestions', exact: true }).click()
    await page.getByText(complete).waitFor()
    assert.deepEqual(calls.map(c => c.body), [{}, {}, { stage: 'groups' }])

    // A collection success followed by a migration failure stays visible as partial success.
    reset('blocked')
    await page.goto(base + '/admin')
    await ingestRow.getByRole('button', { name: 'Run', exact: true }).click()
    await ingestRow.getByRole('button', { name: 'Confirm', exact: true }).click()
    await ingestRow.getByText(/Fact Flow processing incomplete.*20261113_research_publications.sql/).waitFor()
    assert.equal(calls.length, 2)
    assert.equal(articleWrites.length, 0, articleWrites.join('\n'))
    assert.equal(errors.length, 0, errors.join('\n'))
    console.log('Manual ingest browser checks passed: dashboard, source, batch, podcast, saved backlog, suggestions, migration errors and manual article boundary.')
    await context.close()
  } finally {
    await browser.close()
  }
})().catch(e => { console.error(e); process.exitCode = 1 })
