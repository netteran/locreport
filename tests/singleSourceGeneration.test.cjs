const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const { NextRequest } = require('next/server')

function load(file, dependencies = {}) {
  const m = { exports: {} }
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText
  new Function('exports', 'require', 'module', code)(m.exports, id => dependencies[id] || require(id), m)
  return m.exports
}
const schema = load('lib/researchSchema.ts')
const synthesis = load('lib/synthesis.ts')
const citations = load('lib/eventMatching.ts')
const brief = load('lib/compositionBrief.ts')
const citationStyle = load('lib/citationStyle.ts')
const prompts = load('lib/prompts.ts')
const compId = '40000000-0000-4000-8000-000000000001'
const draftId = '50000000-0000-4000-8000-000000000001'
const candidateId = '30000000-0000-4000-8000-000000000001'
const url = 'https://publisher.example/news'
const request = body => new NextRequest(`http://localhost/api/compositions/${compId}/generate`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
})

function generation({ cite = true, authorized = true, sourceCount = 1, title = 'Editor title', angle = 'Explain buyer implications', contents, savedPrompt } = {}) {
  const calls = [], updates = [], modelCalls = []
  const composition = {
    id: compId, status: 'editing', title, angle,
    personal_experience: 'In my projects, integration took two weeks.', target_words: 900,
    composition_sources: [{ candidate_id: candidateId, position: 0, snapshot: {
      title: 'Source announcement', source_name: 'Publisher', source_url: url,
      source_published_at: '2026-11-13', extracted_facts: 'Publisher announced a new product.'
    } }]
  }
  if (sourceCount > 1) composition.composition_sources.push({
    candidate_id: compId, position: 1, snapshot: {
      title: 'Second announcement', source_name: 'Second Publisher', source_url: 'https://second.example/news',
      source_published_at: '2026-11-13', extracted_facts: 'A second product announcement.'
    }
  })
  const service = {
    from(table) {
      let columns = ''
      const q = {
        select(value) { columns = value; return q }, eq() { return q },
        update(value) { updates.push({ table, value }); return q },
        async single() { return { data: columns.startsWith('status,') ? { status: 'editing' } : composition, error: null } },
        async maybeSingle() { return { data: savedPrompt ? { value: savedPrompt } : null, error: null } },
        then(resolve, reject) { return Promise.resolve({ data: null, error: null }).then(resolve, reject) }
      }
      return q
    },
    async rpc(name, params) {
      calls.push({ name, params })
      assert.ok(['claim_composition_generation', 'finish_composition_generation'].includes(name), 'generation must not publish articles')
      return { data: name === 'claim_composition_generation' ? true : draftId, error: null }
    }
  }
  const route = load('app/api/compositions/[id]/generate/route.ts', {
    '@/lib/adminAuth': { requireAdmin: async () => authorized, requireResearchSchema: async () => null, unauthorized: () => Response.json({ error: 'Unauthorized' }, { status: 401 }) },
    '@/lib/supabase/server': { createServiceClient: () => service },
    '@/lib/research': { checked: result => { if (result.error) throw new Error(result.error.message); return result.data } },
    '@/lib/synthesis': synthesis,
    '@/lib/eventMatching': citations,
    '@/lib/citationStyle': citationStyle,
    '@/lib/prompts': prompts,
    '@/lib/slugify': { slugify: title => title.toLowerCase().replaceAll(' ', '-'), uniqueSlug: async slug => slug },
    '@/lib/openai': { getOpenAI: () => ({ chat: { completions: { create: async input => {
      modelCalls.push(input)
      return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({
        title: 'Focused analysis', content: contents ? contents[Math.min(modelCalls.length - 1, contents.length - 1)]
          : '# Focused analysis\n\n' + 'An evidence-based practical implication. '.repeat(20) + (cite ? `[Publisher](${url})` : '')
      }) } }] }
    } } } }) }
  })
  return { route, calls, updates, modelCalls }
}

test('one-source generation sends the saved brief and experience and creates only a pending draft', async () => {
  const { route, calls, updates, modelCalls } = generation()
  const response = await route.POST(request({}), { params: Promise.resolve({ id: compId }) })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { draft_id: draftId })
  assert.equal(modelCalls.length, 1)
  assert.match(modelCalls[0].messages[0].content, /With one selected source/)
  assert.match(modelCalls[0].messages[0].content, /do not imply independent corroboration/)
  const evidence = JSON.parse(modelCalls[0].messages[1].content)
  assert.equal(evidence.sources.length, 1)
  assert.equal(evidence.sources[0].url, url)
  assert.match(evidence.personal_experience, /two weeks/)
  assert.deepEqual(calls.map(c => c.name), ['claim_composition_generation', 'finish_composition_generation'])
  assert.deepEqual(calls[1].params.p_urls, [url])
  assert.equal(updates.length, 0)
})

for (const sourceCount of [1, 2]) {
  test(`uncited ${sourceCount}-source output creates a draft and retains selected evidence`, async () => {
    const { route, calls, updates } = generation({ cite: false, sourceCount })
    const response = await route.POST(request({}), { params: Promise.resolve({ id: compId }) })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { draft_id: draftId })
    assert.deepEqual(calls.map(c => c.name), ['claim_composition_generation', 'finish_composition_generation'])
    assert.deepEqual(calls[1].params.p_urls, sourceCount === 1 ? [url] : [url, 'https://second.example/news'])
    assert.equal(updates.length, 0)
  })
}

for (const title of ['Editor title', '', '   ']) {
  test(`generation preserves the editor title or falls back when blank: ${JSON.stringify(title)}`, async () => {
    const { route, calls } = generation({ title, sourceCount: 2 })
    const response = await route.POST(request({}), { params: Promise.resolve({ id: compId }) })
    assert.equal(response.status, 200)
    const expected = title.trim() || 'Focused analysis'
    assert.equal(calls[1].params.p_title, expected)
    assert.equal(calls[1].params.p_content.split('\n')[0], `# ${expected}`)
    assert.equal(calls[1].params.p_slug, expected.toLowerCase().replaceAll(' ', '-'))
  })
}

test('single-source generation retains the authenticated editor boundary', async () => {
  const { route, calls, modelCalls } = generation({ authorized: false })
  const response = await route.POST(request({}), { params: Promise.resolve({ id: compId }) })
  assert.equal(response.status, 401)
  assert.equal(calls.length, 0)
  assert.equal(modelCalls.length, 0)
})

test('vague source wording gets one repair after saved house style and keeps the editor title and evidence', async () => {
  const body = '# Model title\n\n' + 'Reported costs raise a buyer question. '.repeat(20)
  const { route, calls, modelCalls } = generation({ savedPrompt: 'Saved editorial style', contents: [
    `${body}([source](${url})).`, `${body}The [publisher announcement](${url}) sets out the change.`
  ] })
  assert.equal((await route.POST(request({}), { params: Promise.resolve({ id: compId }) })).status, 200)
  assert.equal(modelCalls.length, 2)
  const policy = modelCalls[0].messages[0].content
  assert.ok(policy.indexOf('SOURCE LINK WORDING') > policy.indexOf('Saved editorial style'))
  assert.match(modelCalls[1].messages.at(-1).content, /Improve only the source-link wording/)
  assert.match(modelCalls[1].messages.at(-2).content, /\[source\]/)
  assert.equal(calls[1].params.p_title, 'Editor title')
  assert.match(calls[1].params.p_content, /\[publisher announcement\]/)
  assert.deepEqual(calls[1].params.p_urls, [url])
  assert.deepEqual(calls.map(c => c.name), ['claim_composition_generation', 'finish_composition_generation'])
})

test('style repair cannot repoint a citation and does not bypass article URL validation', async () => {
  const body = '# Article\n\n' + 'A practical implication. '.repeat(30)
  for (const firstUrl of [url, 'https://invented.test']) {
    const first = `${body}[source](${firstUrl})`
    const { route, calls, modelCalls } = generation({ contents: [first, `${body}[report](https://unrelated.test)`] })
    const response = await route.POST(request({}), { params: Promise.resolve({ id: compId }) })
    assert.equal(modelCalls.length, 2)
    if (firstUrl === url) {
      assert.equal(response.status, 200)
      assert.match(calls[1].params.p_content, /\[source\]/)
      assert.ok(calls[1].params.p_content.includes(url))
    } else {
      assert.equal(response.status, 500)
      assert.equal(calls.length, 1, 'unsupported citations must not create a draft')
    }
  }
})

test('investigation reasoning and reporting gaps reach generation without becoming source evidence', async () => {
  const angle = brief.pitchEditorialDirection({ question: 'Who bears the integration cost?', rationale: 'Unit prices hide operational work.', pitch: {
    stage: 'investigate', why_now: 'A new pricing model', audience: 'Buyers budgeting a pilot', originality: 'Compare total workflow cost',
    counterargument: 'Automation could reduce total costs', missing_evidence: ['Interview a buyer about integration costs'],
    source_contributions: [{ candidate_id: candidateId, contribution: 'Records the announced prices' }]
  } }, [{ id: candidateId, title: 'Pricing announcement' }])
  const { route, calls, modelCalls } = generation({ angle })
  assert.equal((await route.POST(request({}), { params: Promise.resolve({ id: compId }) })).status, 200)
  const input = JSON.parse(modelCalls[0].messages[1].content)
  assert.equal(input.editorial_direction, angle)
  assert.equal(input.sources.length, 1)
  assert.equal(input.sources[0].evidence, 'Publisher announced a new product.')
  assert.match(modelCalls[0].messages[0].content, /working brief, not additional evidence/)
  assert.match(modelCalls[0].messages[0].content, /If reporting is unresolved, narrow the scope/)
  assert.deepEqual(calls.map(c => c.name), ['claim_composition_generation', 'finish_composition_generation'])
})

test('an older database explains the single-source migration while multi-source creation continues', async () => {
  const route = load('app/api/compositions/route.ts', {
    '@/lib/compositionBrief': brief,
    '@/lib/adminAuth': { requireAdmin: async () => ({ id: candidateId }), requireResearchSchema: async () => null },
    '@/lib/supabase/server': { createServiceClient: () => ({ rpc: async (_name, params) => params.p_candidates.length === 1
      ? { data: null, error: { message: 'Select 2–8 source candidates' } }
      : { data: compId, error: null } }) },
    '@/lib/research': { checked: result => { if (result.error) throw new Error(result.error.message); return result.data } },
    '@/lib/researchSchema': schema
  })
  const single = await route.POST(request({ candidate_ids: [candidateId] }))
  assert.equal(single.status, 503)
  assert.match((await single.json()).error, /20261114_single_source_articles.sql/)
  const multi = await route.POST(request({ candidate_ids: [candidateId, compId] }))
  assert.equal(multi.status, 201)
  assert.equal(schema.singleSourceMigrationProblem({ message: 'permission denied' }, 1), null)
})
