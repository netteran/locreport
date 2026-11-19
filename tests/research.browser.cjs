// Run against the isolated app/fixture described in docs/research-workflow.md.
const { chromium } = require('playwright')
const assert = require('node:assert/strict')
const fs = require('node:fs')
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
const readyPitch = {
  id: 'ready-pitch', title: 'What enterprise buyers should verify', question: 'How should buyers evaluate the new workflow?',
  rationale: 'Connect the launch with an immediate buyer decision.', candidate_ids: ids,
  pitch: { stage: 'ready', why_now: 'A supplier announced a new workflow.', audience: 'Buyers evaluating a pilot.',
    originality: 'Compare operational responsibilities with the launch promise.', counterargument: 'The workflow may already handle common exceptions.',
    missing_evidence: [], source_contributions: ids.map((candidate_id, i) => ({ candidate_id, contribution: 'Documents workflow evidence ' + (i + 1) })),
    scores: { reader_value: 4, originality: 4, evidence: 4 }, score: 80 }
}
const investigationPitch = { ...readyPitch, id: 'investigation-pitch', title: 'Who carries the hidden cost of language AI?',
  question: 'Could lower unit prices increase operating costs?', rationale: 'The sources suggest a richer question about the work between a model and a dependable service.',
  pitch: { ...readyPitch.pitch, stage: 'investigate', why_now: 'Pricing and workflow announcements create a useful tension.',
    originality: 'Connect headline savings with evaluation work and exception handling.',
    missing_evidence: ['Compare actual evaluation costs with a buyer.', 'Find evidence that could disprove the cost-shifting premise.'],
    scores: { reader_value: 5, originality: 5, evidence: 2 }, score: 85 }
}
;(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  })
  try {
    const context = await browser.newContext()
    await context.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
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
          groups: [readyPitch, investigationPitch, { ...investigationPitch, id: 'stale-pitch', title: 'A pitch with unavailable evidence', candidate_ids: [ids[0], 'missing-source'] },
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
    await page.route('**/api/compositions', (route) => {
      const body = route.request().postDataJSON(), selected = body.candidate_ids
      Object.assign(composition, { title: body.title || '', angle: body.angle || '', personal_experience: '', draft_id: null, status: 'editing' })
      composition.composition_sources = candidates.filter(c => selected.includes(c.id)).map((snapshot, i) => ({
        candidate_id: snapshot.id, snapshot, covered: false, position: i
      }))
      return route.fulfill({ status: 201, json: { id: compId } })
    })
    await page.route(`**/api/compositions/${compId}`, async (route) => {
      if (route.request().method() === 'PATCH') {
        savedBrief = route.request().postDataJSON()
        Object.assign(composition, savedBrief)
        composition.composition_sources = savedBrief.candidate_ids.map(candidate_id => ({ candidate_id, snapshot: candidates.find(c => c.id === candidate_id), covered: false, position: savedBrief.candidate_ids.indexOf(candidate_id) }))
      }
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
          title: composition.title || 'Combined analysis',
          content: '# ' + (composition.title || 'Combined analysis') + '\n\nA sourced article.',
          source_url: null,
          status: 'pending',
          composition_id: compId,
          created_at: '2026-11-13T09:00:00Z',
          extracted_facts: 'Pinned evidence',
          fact: null
        }
      })
    )
    // A single selection uses the same saved direction/experience and manual generation flow.
    await page.goto(base + '/admin/candidates')
    await page.getByRole('checkbox', { name: 'Select Evidence source 1' }).check()
    await page.getByRole('button', { name: 'Create article', exact: true }).click()
    await page.getByRole('heading', { name: 'Create article', exact: true }).waitFor()
    await page.getByRole('heading', { name: 'Selected sources (1/8)', exact: true }).waitFor()
    assert.equal(generationCalls, 0)
    assert.equal(await page.getByRole('button', { name: 'Save brief', exact: true }).isEnabled(), true)
    assert.equal(await page.getByRole('button', { name: 'Generate draft', exact: true }).isEnabled(), false)
    await page.getByRole('button', { name: 'Remove', exact: true }).click()
    assert.equal(await page.getByRole('button', { name: 'Save brief', exact: true }).isEnabled(), false)
    assert.equal(await page.getByRole('button', { name: 'Generate draft', exact: true }).isEnabled(), false)
    await page.getByRole('combobox', { name: 'Add another source' }).selectOption(ids[0])
    await page.getByLabel('Central question and editorial direction').fill('Explain what this one announcement means for buyers.')
    await page.getByLabel('Your personal experience').fill('In my projects, integration needed more time than setup.')
    await page.getByRole('button', { name: 'Save brief', exact: true }).click()
    await page.getByText('Brief saved', { exact: true }).waitFor()
    assert.deepEqual(savedBrief.candidate_ids, [ids[0]])
    assert.match(savedBrief.personal_experience, /my projects/)
    assert.equal(generationCalls, 0)
    await page.getByRole('button', { name: 'Generate draft', exact: true }).click()
    await page.waitForURL(`**/admin/drafts/${draftId}`)
    assert.equal(generationCalls, 1)
    await page.getByRole('button', { name: 'Approve & publish', exact: true }).waitFor()

    generationCalls = 0
    savedBrief = null
    await page.goto(base + '/admin/candidates')
    await page.getByRole('heading', { name: 'Articles creation', exact: true }).waitFor()
    await page.getByRole('checkbox', { name: 'Select Evidence source 1' }).check()
    await page.getByRole('checkbox', { name: 'Select Evidence source 2' }).check()
    await page.getByRole('button', { name: 'Combine selected' }).click()
    await page.getByRole('heading', { name: 'Create article', exact: true }).waitFor()
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
    // Either pitch opens the complete saved brief and requires an explicit draft action.
    fs.mkdirSync('work/investigation-preview', { recursive: true })
    for (const pitch of [readyPitch, investigationPitch]) {
      generationCalls = 0
      await page.goto(base + '/admin/candidates')
      await page.getByRole('button', { name: 'Suggested articles', exact: true }).click()
      await page.getByRole('heading', { name: readyPitch.title, exact: true }).waitFor()
      await page.getByRole('heading', { name: investigationPitch.title, exact: true }).waitFor()
      const card = page.locator('section').filter({ has: page.getByRole('heading', { name: pitch.title, exact: true }) })
      if (pitch.pitch.stage === 'investigate') {
        const stale = page.locator('section').filter({ has: page.getByRole('heading', { name: 'A pitch with unavailable evidence', exact: true }) })
        assert.equal(await stale.getByRole('button', { name: 'Choose sources & direction', exact: true }).isDisabled(), true)
        await page.screenshot({ path: 'work/investigation-preview/suggested-investigations.png', fullPage: true })
      }
      await card.getByRole('button', { name: 'Choose sources & direction', exact: true }).click()
      await page.getByRole('heading', { name: 'Create article', exact: true }).waitFor()
      assert.equal(generationCalls, 0)
      const direction = page.getByLabel('Central question and editorial direction')
      const original = await direction.inputValue()
      for (const text of [pitch.question, pitch.rationale, pitch.pitch.why_now, pitch.pitch.audience, pitch.pitch.originality, pitch.pitch.counterargument, ...pitch.pitch.missing_evidence, ...pitch.pitch.source_contributions.map(s => s.contribution)]) assert.ok(original.includes(text), text)
      if (pitch.pitch.stage === 'investigate') assert.match(original, /unresolved reporting, not an established conclusion/)
      const edited = original + '\n\nScope: explain what the selected evidence supports and what remains an open question.'
      await direction.fill(edited)
      await page.getByRole('button', { name: 'Save brief', exact: true }).click()
      await page.getByText('Brief saved', { exact: true }).waitFor()
      assert.equal(savedBrief.angle, edited)
      assert.deepEqual(savedBrief.candidate_ids, ids)
      await page.reload()
      await page.getByRole('heading', { name: 'Selected sources (2/8)', exact: true }).waitFor()
      assert.equal(await direction.inputValue(), edited)
      assert.equal(generationCalls, 0)
      if (pitch.pitch.stage === 'investigate') await page.screenshot({ path: 'work/investigation-preview/investigation-brief.png', fullPage: true })
      await page.getByRole('button', { name: 'Generate draft', exact: true }).click()
      await page.waitForURL(`**/admin/drafts/${draftId}`)
      await page.getByRole('button', { name: 'Approve & publish', exact: true }).waitFor()
      assert.equal(generationCalls, 1)
      assert.equal(await page.getByLabel('Title', { exact: true }).inputValue(), pitch.title)
    }
    // Public wire entries lead to their published analysis and keep original attribution.
    await page.goto(base + '/fact-flow')
    await page
      .getByRole('link', { name: 'A sourced industry announcement.', exact: true })
      .waitFor()
    assert.equal(
      await page
        .getByRole('link', { name: 'A sourced industry announcement.', exact: true })
        .getAttribute('href'),
      '/articles/combined-analysis'
    )
    assert.equal(await page.locator('[id="10000000-0000-4000-8000-000000000001"]').getByRole('link', {name:'Source: Primary source ↗', exact:true}).getAttribute('href'), 'https://example.test/announcement')
    await page.getByText('2 supporting sources', { exact: true }).click()
    await page.getByRole('link', { name: 'Industry publication ↗', exact: true }).waitFor()
    await page
      .getByRole('link', { name: 'LocReport analysis: Combined analysis →', exact: true })
      .waitFor()
    const rss = await context.request.get(base + '/fact-flow/feed.xml')
    assert.equal(rss.status(), 200)
    const xml = await rss.text()
    assert.match(xml, /<link>https:\/\/locreport.com\/articles\/combined-analysis<\/link>/)
    assert.match(xml, /<guid isPermaLink="false">https:\/\/locreport.com\/fact-flow#10000000-0000-4000-8000-000000000001<\/guid>/)
    await page.goto(base + '/')
    assert.equal(await page.getByRole('link', { name: 'A sourced industry announcement.', exact: true }).getAttribute('href'), '/articles/combined-analysis')
    assert.equal(await page.getByRole('link', { name: 'Original source ↗', exact: true }).getAttribute('href'), 'https://example.test/announcement')
    assert.equal(errors.length, 0, errors.join('\n'))
    console.log(
      'Browser checks passed: single/multiple sources, ready and investigation pitches → complete saved/reloaded briefs → explicit pending drafts, unavailable-source guard, manual publication boundary and sourced Fact Flow.'
    )
    await context.close()
  } finally {
    await browser.close()
  }
})().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
