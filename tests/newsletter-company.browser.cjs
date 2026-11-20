// Uses real edition/save/preview routes against the isolated editorial fixture.
// Delivery is intercepted and can only be a recipient check.
const { chromium } = require('playwright')
const assert = require('node:assert/strict')
const fs = require('node:fs'), ts = require('typescript')
const moduleCopy = { exports: {} }
new Function('exports', 'require', 'module', ts.transpileModule(fs.readFileSync('lib/email/editionCompany.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText)(moduleCopy.exports, require, moduleCopy)
const { editionCompanySlug } = moduleCopy.exports
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000'
const profile = slug => 'https://locreport.com/directory/' + slug

;(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH,
    args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, reducedMotion: 'reduce' })
    await context.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
    const now = Math.floor(Date.now() / 1000)
    const user = { id: '90000000-0000-4000-8000-000000000001', email: 'editor@example.test', aud: 'authenticated', role: 'authenticated' }
    const token = [Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
      Buffer.from(JSON.stringify({ sub: user.id, email: user.email, aud: user.aud, role: user.role, iat: now, exp: now + 3600 })).toString('base64url'), 'fixture'].join('.')
    await context.addCookies([{ name: 'sb-127-auth-token', url: base,
      value: 'base64-' + Buffer.from(JSON.stringify({ access_token: token, refresh_token: 'fixture-refresh', expires_at: now + 3600, expires_in: 3600, token_type: 'bearer', user })).toString('base64url') }])
    const sends = [], refreshes = [], errors = [], dialogs = []
    await context.route('**/api/digest/recipients', route => route.fulfill({ json: { subscribers: [{ id: user.id, email: 'reader@example.test' }] } }))
    await context.route('**/api/digest/send*', route => {
      const dry = new URL(route.request().url()).searchParams.get('dry') === '1'
      sends.push({ dry })
      return route.fulfill({ status: dry ? 200 : 400, json: dry ? { recipients: 1, skipped: 0, articles: 1 } : { error: 'Delivery disabled in this test' } })
    })
    const page = await context.newPage()
    page.setDefaultTimeout(30000)
    page.on('pageerror', error => errors.push(error.message))
    page.on('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.accept() })
    page.on('request', request => {
      const url = new URL(request.url())
      if (url.pathname === '/api/digest/edition' && url.searchParams.get('refresh') === '1') refreshes.push(url.searchParams.get('exclude_company'))
    })
    const current = async () => {
      const response = await context.request.get(base + '/api/digest/edition')
      assert.equal(response.status(), 200)
      return response.json()
    }
    const body = page.getByLabel('Newsletter content', { exact: true })
    const preview = page.getByRole('button', { name: 'View saved preview', exact: true })
    const check = page.getByRole('button', { name: 'Check recipients', exact: true })
    const save = async () => {
      await page.getByRole('button', { name: 'Save edition', exact: true }).click()
      await page.getByText('Complete edition saved.', { exact: false }).waitFor()
    }
    const refresh = async previousSlug => {
      const response = page.waitForResponse(r => {
        const url = new URL(r.url())
        return url.pathname === '/api/digest/edition' && url.searchParams.get('refresh') === '1'
      })
      await page.getByRole('button', { name: 'Refresh from latest content', exact: true }).click()
      const result = await response
      assert.equal(result.status(), 200)
      const copy = await result.json()
      await page.waitForFunction(expected => document.querySelector('textarea[aria-label="Newsletter content"]').value === expected, copy.body_markdown)
      assert.equal(refreshes.at(-1), previousSlug)
      assert.notEqual(editionCompanySlug(copy.body_markdown), previousSlug)
      assert.equal(copy.saved, false)
      return copy
    }
    await page.goto(base + '/admin/weekly', { waitUntil: 'networkidle' })
    await body.waitFor()
    const initialSlug = editionCompanySlug(await body.inputValue())
    assert.ok(initialSlug)
    await save()
    const original = await current()
    await check.click()
    await page.getByRole('button', { name: 'Confirm send', exact: true }).waitFor()
    await refresh(initialSlug)
    assert.equal(await preview.isDisabled(), true)
    assert.equal(await check.isDisabled(), true)
    assert.equal(await page.getByRole('button', { name: 'Confirm send', exact: true }).count(), 0)
    assert.equal((await current()).body_markdown, original.body_markdown)
    const firstSlug = editionCompanySlug(await body.inputValue())
    const second = await refresh(firstSlug)
    const secondSlug = editionCompanySlug(second.body_markdown)
    const manualSlug = secondSlug === 'phrase' ? 'crowdin' : 'phrase'
    await body.fill(second.body_markdown.replaceAll(profile(secondSlug), profile(manualSlug)))
    const latest = await refresh(manualSlug)
    assert.ok(dialogs.length >= 2, 'repeated refresh must still protect unsaved edits')
    await save()
    const saved = await current()
    assert.equal(saved.body_markdown, latest.body_markdown)
    await page.reload({ waitUntil: 'networkidle' })
    assert.equal(await body.inputValue(), latest.body_markdown)
    assert.equal(await preview.isDisabled(), false)
    const rendered = await context.request.get(base + '/api/digest/preview?revision=' + saved.revision)
    assert.equal(rendered.status(), 200)
    assert.ok((await rendered.text()).includes(profile(editionCompanySlug(latest.body_markdown))))
    assert.deepEqual(sends, [{ dry: true }])
    assert.deepEqual(errors, [])
    console.log('Company refresh verified: different working selections, unsaved/manual exclusions, preserved saved copy, cleared send confirmation, save/reload and matching saved preview. No email sent.')
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
