const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), ts = require('typescript')
const { NextRequest } = require('next/server')
function load(file, dependencies = {}) {
  const module = { exports: {} }
  new Function('exports', 'require', 'module', ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText)(module.exports, id => dependencies[id] || require(id), module)
  return module.exports
}
const brief = load('lib/compositionBrief.ts'), editorial = load('lib/editorialPitches.ts')
const group = { question: 'Could cheaper translation raise total cost?', rationale: 'Look beyond the unit price.', pitch: {
  stage: 'investigate', why_now: 'A pricing change', audience: 'Buyers planning a pilot', originality: 'Compare the work around the model',
  counterargument: 'Automation could reduce operating cost', missing_evidence: ['Interview a buyer', 'Check evaluation costs'],
  source_contributions: [{ candidate_id: 'source', contribution: 'Documents the new pricing' }]
} }
test('starting an investigation retains its editorial reasoning and every reporting gap', () => {
  const direction = brief.pitchEditorialDirection(group, [{ id: 'source', title: 'Pricing announcement' }])
  for (const text of [group.question, group.rationale, group.pitch.why_now, group.pitch.audience, group.pitch.originality, group.pitch.counterargument, ...group.pitch.missing_evidence, group.pitch.source_contributions[0].contribution, 'Pricing announcement']) assert.ok(direction.includes(text), text)
  assert.match(direction, /unresolved reporting, not an established conclusion/)
  assert.match(direction, /do not invent interviews/)
  assert.equal(group.pitch.stage, 'investigate', 'starting a brief does not upgrade its evidence assessment')
})
test('ready and older suggestions use the same brief workflow without invented reporting requirements', () => {
  const direction = brief.pitchEditorialDirection({ ...group, pitch: { ...group.pitch, stage: 'ready', missing_evidence: [] } }, [])
  assert.ok(direction.includes(group.rationale)); assert.ok(direction.includes(group.pitch.why_now))
  assert.doesNotMatch(direction, /Evidence status: worth investigating|Reporting to resolve:/)
  assert.equal(brief.pitchEditorialDirection({ question: 'An older question', pitch: null }, []), 'An older question')
})
test('the complete maximum normalized pitch fits the shared direction limit without losing its final contribution', () => {
  const ids = Array.from({ length: 8 }, (_, i) => 'source-' + i)
  const large = editorial.normalizePitch({ title: 'A broad investigation', question: 'Q'.repeat(1000), rationale: 'R'.repeat(2000), candidate_ids: ids,
    stage: 'investigate', why_now: 'W'.repeat(1500), audience: 'A'.repeat(1500), originality: 'O'.repeat(1500), counterargument: 'C'.repeat(1500),
    missing_evidence: ids.map((_, i) => 'Task ' + i + ' ' + 'M'.repeat(1490)),
    source_contributions: ids.map((candidate_id, i) => ({ candidate_id, contribution: 'Contribution ' + i + ' ' + 'S'.repeat(1480) })),
    scores: { reader_value: 5, originality: 5, evidence: 2 }
  }, new Set(ids))
  const direction = brief.pitchEditorialDirection(large, ids.map(id => ({ id, title: 'T'.repeat(500) })))
  assert.ok(direction.length > 12000)
  assert.ok(direction.length <= brief.EDITORIAL_DIRECTION_LIMIT)
  assert.ok(direction.includes(large.pitch.missing_evidence[7]))
  assert.ok(direction.includes(large.pitch.source_contributions[7].contribution))
})
test('composition creation and editing retain long directions and reject invalid input before source reservation', async () => {
  const writes = [], reservations = []; let authorized = true
  const service = { rpc: async (name, params) => { reservations.push([name, params]); return { data: 'composition', error: null } }, from() {
    const query = { update(value) { writes.push(value); return query }, eq() { return query }, in() { return query }, select() { return query },
      maybeSingle: async () => ({ data: { id: 'composition', ...writes.at(-1) }, error: null }),
      then(resolve, reject) { return Promise.resolve({ data: null, error: null }).then(resolve, reject) }
    }; return query
  } }
  const dependencies = { '@/lib/compositionBrief': brief, '@/lib/adminAuth': { requireAdmin: async () => authorized ? { id: 'editor' } : null, unauthorized: () => Response.json({}, { status: 401 }), requireResearchSchema: async () => null }, '@/lib/supabase/server': { createServiceClient: () => service }, '@/lib/research': { checked(result) { if (result.error) throw new Error(result.error.message); return result.data } }, '@/lib/researchSchema': { singleSourceMigrationProblem: () => null } }
  const create = load('app/api/compositions/route.ts', dependencies), edit = load('app/api/compositions/[id]/route.ts', dependencies)
  const request = body => new NextRequest('http://localhost/api/compositions', { method: 'POST', body: JSON.stringify(body) })
  const direction = 'Saved editorial context. '.repeat(900)
  assert.equal((await create.POST(request({ candidate_ids: ['source'], title: 'Investigation', angle: direction }))).status, 201)
  assert.equal(writes[0].angle, direction)
  assert.equal((await edit.PATCH(request({ angle: direction + ' Final task.' }), { params: Promise.resolve({ id: 'composition' }) })).status, 200)
  assert.equal(writes[1].angle, direction + ' Final task.')
  for (const angle of [42, null, 'x'.repeat(brief.EDITORIAL_DIRECTION_LIMIT + 1)]) assert.equal((await create.POST(request({ candidate_ids: ['source'], angle }))).status, 400)
  assert.equal(reservations.length, 1)
  assert.equal((await edit.PATCH(request({ angle: 'x'.repeat(brief.EDITORIAL_DIRECTION_LIMIT + 1) }), { params: Promise.resolve({ id: 'composition' }) })).status, 400)
  authorized = false
  assert.equal((await create.POST(request({ candidate_ids: ['source'], angle: direction }))).status, 401)
})
