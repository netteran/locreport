const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const { spawnSync } = require('node:child_process')
const workflow = fs.readFileSync('.github/workflows/ingest.yml', 'utf8')
function step(name) {
  const start = workflow.indexOf('      - name: ' + name + '\n')
  assert.ok(start >= 0, 'missing workflow step: ' + name)
  const end = workflow.indexOf('\n      - name:', start + 1)
  return workflow.slice(start, end < 0 ? undefined : end)
}
function execute(name, response) {
  const script = step(name).split('        run: |\n')[1].split('\n').filter(line => line.startsWith('          ') || !line.trim()).map(line => line.slice(10)).join('\n')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ingest-workflow-'))
  try {
    fs.writeFileSync(path.join(dir, 'curl'), '#!/usr/bin/env node\nprocess.stdout.write(process.env.INGEST_TEST_RESPONSE)\n', { mode: 0o755 })
    return spawnSync('bash', ['-e', '-o', 'pipefail', '-c', script], { encoding: 'utf8', env: { ...process.env,
      PATH: dir + path.delimiter + process.env.PATH, CRON_SECRET: 'fixture-cron', VERCEL_AUTOMATION_SECRET: 'fixture-automation',
      INGEST_TEST_RESPONSE: typeof response === 'string' ? response : JSON.stringify(response) } })
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
}
test('a partial feed-generation response makes the workflow fail visibly', () => {
  const result = execute('Refresh generated feeds', { processed: 2, succeeded: 1, failed: 1, results: [{ name: 'Good', status: 'success', itemCount: 5 }, { name: 'Broken', status: 'error' }] })
  assert.equal(result.status, 1)
  assert.match(result.stdout, /::error::1 generated feed/)
})
test('collection errors cannot pass as a green zero-result job', () => {
  const failed = execute('Run ingest', { processed: 0, skipped: 0, errors: ['Publisher: HTTP 403'], source_results: [] })
  assert.equal(failed.status, 1)
  assert.match(failed.stdout, /::error::1 collection error/)
  const quiet = execute('Run ingest', { processed: 0, skipped: 2, errors: [], complete: true })
  assert.equal(quiet.status, 0, quiet.stderr)
})
test('deferred work warns without treating ordinary extraction limits as failures', () => {
  const result = execute('Run ingest', { processed: 15, skipped: 0, errors: [], complete: false })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /::warning::Some feed entries were deferred/)
})
test('hosting security HTML still fails before the JSON response is trusted', () => {
  const result = execute('Run ingest', '<html>Security checkpoint</html>')
  assert.equal(result.status, 1)
  assert.match(result.stdout, /Expected a JSON object/)
})
test('downstream stages continue despite feed and collection failures', () => {
  for (const name of ['Run ingest', 'Podcasts (auto)', 'Match events and publish trusted Fact Flow items', 'Refresh suggested articles (never generate or publish articles)']) {
    assert.match(step(name), /if: \$\{\{ !cancelled\(\) && steps\.dst\.outputs\.proceed == 'true' \}\}/)
  }
})
