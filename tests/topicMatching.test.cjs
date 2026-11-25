const { test } = require('node:test')
const assert = require('node:assert/strict')
const { load } = require('./fixtures/typescript.cjs')

/** A tiny in-memory stand-in for the Supabase query builder: enough for lib/topicMatching.ts. */
function fakeService(tables, rpc = {}) {
  const log = []
  return {
    log, tables,
    rpc: async (name, args) => { log.push(['rpc', name, args]); return { data: rpc[name] ? rpc[name](args) : [], error: null } },
    from(table) {
      const state = { op: 'select', filters: [], payload: null, options: null, single: false, maybe: false, head: false }
      const rows = () => (tables[table] ||= []).filter(row => state.filters.every(([col, test]) => test(row[col])))
      const q = {
        select(_cols, opts) { if (state.op === 'select' && opts?.head) state.head = true; return q },
        eq(col, v) { state.filters.push([col, x => x === v]); return q },
        in(col, vs) { state.filters.push([col, x => vs.includes(x)]); return q },
        order() { return q }, limit() { return q },
        single() { state.single = true; return q }, maybeSingle() { state.maybe = true; return q },
        update(payload) { state.op = 'update'; state.payload = payload; return q },
        delete() { state.op = 'delete'; return q },
        insert(payload) { state.op = 'insert'; state.payload = payload; return q },
        upsert(payload, options) { state.op = 'upsert'; state.payload = payload; state.options = options; return q },
        then(resolve, reject) {
          log.push([state.op, table, state.payload, state.options])
          let data = null
          if (state.op === 'select') data = rows()
          if (state.op === 'update') { data = rows(); data.forEach(row => Object.assign(row, state.payload)) }
          if (state.op === 'delete') tables[table] = tables[table].filter(row => !rows().includes(row))
          if (state.op === 'insert' || state.op === 'upsert') (tables[table] ||= []).push(...[].concat(state.payload))
          if (state.single || state.maybe) data = data?.[0] ?? null
          return Promise.resolve({ data, error: null, count: Array.isArray(data) ? data.length : null }).then(resolve, reject)
        }
      }
      return q
    }
  }
}

function loadMatching({ model, sent }) {
  const research = load('lib/research.ts', {
    '@/lib/openai': { getOpenAI: () => ({}) }, '@/lib/embeddings': { embedText: async () => [] },
    '@/lib/revalidate': { revalidateFactSurfaces() {} }
  })
  return load('lib/topicMatching.ts', {
    '@/lib/research': { checked: research.checked, jsonModel: async (...args) => model(...args) },
    '@/lib/embeddings': { embedTexts: async texts => texts.map(() => [0.1]) },
    '@/lib/email/send': {
      SITE_URL: 'https://locreport.com', fromWithName: n => `${n} <a@b>`,
      getResend: () => ({ emails: { send: async message => { sent.push(message); return { error: null } } } })
    }
  })
}

const topic = { id: 't1', title: 'MTPE <rates>', brief: 'Are rates collapsing?', status: 'watching', notify_email: true, brief_version: 2, ready_at: null, notified_at: null }
const candidate = (id, publisher, event_id = null) => ({
  id, title: `Title ${id}`, source_url: `https://x.test/${id}`, source_name: publisher, source_published_at: '2026-11-01',
  extracted_facts: 'Evidence '.repeat(400), status: 'available', event_id, reserved_by: null
})

test('a batch records one judgement per shortlisted source, including ones the model skipped', async () => {
  const sent = [], calls = []
  const matching = loadMatching({ sent, model: (prompt, input, schema) => {
    calls.push({ input, schema })
    return { judgements: [{ candidate_id: 'a', relevance: 3, role: 'data', contribution: 'Has figures' }] }
  } })
  const service = fakeService(
    { editorial_topics: [{ ...topic }], source_candidates: [candidate('a', 'Slator'), candidate('b', 'Nimdzi')], topic_matches: [] },
    { topic_shortlist: () => [{ candidate_id: 'a', similarity: 0.8 }, { candidate_id: 'b', similarity: 0.5 }] }
  )
  assert.equal(await matching.matchTopicBatch(service, topic), 2)
  assert.deepEqual(service.tables.topic_matches.map(m => [m.candidate_id, m.relevance, m.role, m.similarity, m.judged_version]),
    [['a', 3, 'data', 0.8, 2], ['b', 0, 'context', 0.5, 2]])
  assert.deepEqual(service.log.find(e => e[0] === 'upsert')[3], { onConflict: 'topic_id,candidate_id', ignoreDuplicates: true })
  assert.equal(calls[0].input.sources[0].evidence.length, 2000, 'evidence is capped per source')
  assert.deepEqual(calls[0].schema.properties.judgements.items.properties.candidate_id.enum, ['a', 'b'])
  assert.equal(service.tables.editorial_topics[0].last_matched_at !== undefined, true)
})

test('an empty shortlist costs no model call', async () => {
  let called = false
  const matching = loadMatching({ sent: [], model: () => { called = true } })
  const service = fakeService({ editorial_topics: [{ ...topic }], topic_matches: [] })
  assert.equal(await matching.matchTopicBatch(service, topic), 0)
  assert.equal(called, false)
})

test('reaching readiness marks the topic ready and emails the admin exactly once', async () => {
  const sent = []
  process.env.ADMIN_EMAIL = 'editor@example.test'; process.env.RESEND_API_KEY = 'test'
  const matching = loadMatching({ sent, model: () => ({}) })
  const m = (candidate_id, role) => ({ topic_id: 't1', candidate_id, similarity: 0.7, relevance: 2, role, contribution: 'x', decision: 'suggested' })
  const service = fakeService({
    editorial_topics: [{ ...topic }],
    topic_matches: [m('a', 'supports'), m('b', 'data'), m('c', 'contradicts'), m('d', 'supports')],
    source_candidates: [candidate('a', 'Slator', 'e1'), candidate('d', 'MultiLingual', 'e1'), candidate('b', 'Nimdzi'), candidate('c', 'CSA')]
  })
  const first = await matching.refreshTopicStatus(service, 't1')
  assert.equal(first.status, 'ready')
  assert.equal(first.readiness.independent, 3, 'two reports of event e1 count once')
  const row = service.tables.editorial_topics[0]
  assert.equal(row.status, 'ready'); assert.ok(row.ready_at); assert.ok(row.notified_at)
  assert.equal(sent.length, 1)
  assert.equal(sent[0].to, 'editor@example.test')
  assert.match(sent[0].subject, /Ready to write: MTPE <rates>/)
  assert.match(sent[0].html, /MTPE &lt;rates&gt;/, 'the title is escaped in the email body')
  assert.match(sent[0].html, /admin\/candidates\?tab=topics/)
  await matching.refreshTopicStatus(service, 't1')
  assert.equal(sent.length, 1, 'no repeat email')

  // Rejecting evidence drops the topic back to watching; nothing is emailed for that.
  service.tables.topic_matches.forEach(match => { if (match.candidate_id !== 'a') match.decision = 'rejected' })
  assert.equal((await matching.refreshTopicStatus(service, 't1')).status, 'watching')
  assert.equal(service.tables.editorial_topics[0].ready_at, null)
  assert.equal(sent.length, 1)
  delete process.env.ADMIN_EMAIL; delete process.env.RESEND_API_KEY
})

test('no email without opt-in or configuration, and paused topics are left alone', async () => {
  const sent = []
  const matching = loadMatching({ sent, model: () => ({}) })
  const ready = ['a', 'b', 'c'].map((id, i) => ({ topic_id: 't1', candidate_id: id, similarity: 1, relevance: 3, role: 'supports', contribution: 'x', decision: 'suggested', i }))
  const sources = [candidate('a', 'Slator'), candidate('b', 'Nimdzi'), candidate('c', 'CSA')]
  const optedIn = fakeService({ editorial_topics: [{ ...topic }], topic_matches: ready.map(r => ({ ...r })), source_candidates: sources })
  assert.equal((await matching.refreshTopicStatus(optedIn, 't1')).status, 'ready')
  assert.equal(sent.length, 0, 'ADMIN_EMAIL is not set')
  assert.equal(optedIn.tables.editorial_topics[0].notified_at, null, 'an unsent email is not recorded as sent')
  const paused = fakeService({ editorial_topics: [{ ...topic, status: 'paused' }], topic_matches: ready.map(r => ({ ...r })), source_candidates: sources })
  assert.equal((await matching.refreshTopicStatus(paused, 't1')).status, 'paused')
})

test('a missing migration is recognised so scheduled runs skip topics instead of failing', () => {
  const matching = loadMatching({ sent: [], model: () => ({}) })
  assert.equal(matching.topicsMigrationMissing({ code: 'PGRST205', message: "Could not find the table 'public.editorial_topics' in the schema cache" }), true)
  assert.equal(matching.topicsMigrationMissing({ code: '42P01', message: 'relation "topic_matches" does not exist' }), true)
  assert.equal(matching.topicsMigrationMissing({ code: '42501', message: 'permission denied for table editorial_topics' }), false)
  assert.equal(matching.topicsMigrationMissing(null), false)
})

test('scheduled matching skips paused topics, survives one failing topic and respects its time budget', async () => {
  const matching = loadMatching({ sent: [], model: () => { throw new Error('model unavailable') } })
  const service = fakeService({
    editorial_topics: [{ ...topic, id: 'broken' }, { ...topic, id: 'quiet' }, { ...topic, id: 'paused', status: 'paused' }],
    source_candidates: [candidate('a', 'Slator')], topic_matches: []
  }, { topic_shortlist: ({ p_topic }) => p_topic === 'broken' ? [{ candidate_id: 'a', similarity: 0.9 }] : [] })
  const result = await matching.matchOpenTopics(service)
  assert.equal(result.topics, 2, 'paused topics are not matched')
  assert.equal(result.judged, 0)
  assert.equal(result.errors.length, 1)
  assert.match(result.errors[0], /model unavailable/)
  assert.deepEqual(service.log.filter(e => e[0] === 'rpc').map(e => e[2].p_topic), ['broken', 'quiet'])
  const none = await matching.matchOpenTopics(fakeService({ editorial_topics: [{ ...topic }] }), -1)
  assert.deepEqual(none, { judged: 0, topics: 1, errors: [] }, 'an exhausted budget starts no topic')
})
