const { test } = require('node:test')
const assert = require('node:assert/strict')
const { load } = require('./fixtures/typescript.cjs')

const topics = load('lib/editorialTopics.ts')

test('topic input is trimmed, terms are deduplicated and limits are enforced', () => {
  const ok = topics.normalizeTopicInput({ title: '  MTPE rates ', brief: ' Are they collapsing? ', required_terms: 'MTPE,  post-editing , MTPE, x', notify_email: true })
  assert.deepEqual(ok, { topic: { title: 'MTPE rates', brief: 'Are they collapsing?', required_terms: ['MTPE', 'post-editing'], notify_email: true } })
  assert.equal(topics.normalizeTopicInput({ title: 'T', brief: 'B', notify_email: 'yes' }).topic.notify_email, false)
  assert.match(topics.normalizeTopicInput({ title: '', brief: 'B' }).error, /title/)
  assert.match(topics.normalizeTopicInput({ title: 'T', brief: 'x'.repeat(4001) }).error, /4000/)
  assert.match(topics.normalizeTopicInput({ title: 'T', brief: 'B', required_terms: Array.from({ length: 13 }, (_, i) => `term${i}`) }).error, /12/)
})

test('judgements cover every supplied source exactly once and never trust invented or unexplained scores', () => {
  const result = topics.normalizeJudgements({ judgements: [
    { candidate_id: 'a', relevance: 3, role: 'data', contribution: 'Gives 2026 rate figures' },
    { candidate_id: 'a', relevance: 0, role: 'context', contribution: 'duplicate ignored' },
    { candidate_id: 'invented', relevance: 3, role: 'supports', contribution: 'Not supplied' },
    { candidate_id: 'b', relevance: 3, role: 'nonsense', contribution: '' },
    { candidate_id: 'c', relevance: 9.4, role: 'contradicts', contribution: 'Rates rose for legal' }
  ] }, ['a', 'b', 'c', 'd'])
  assert.deepEqual(result, [
    { candidate_id: 'a', relevance: 3, role: 'data', contribution: 'Gives 2026 rate figures' },
    { candidate_id: 'b', relevance: 1, role: 'context', contribution: '' },
    { candidate_id: 'c', relevance: 3, role: 'contradicts', contribution: 'Rates rose for legal' },
    { candidate_id: 'd', relevance: 0, role: 'context', contribution: '' }
  ])
  assert.equal(topics.normalizeJudgements(null, ['a'])[0].relevance, 0)
  const schema = topics.judgeSchema(['a', 'b'])
  assert.deepEqual(schema.properties.judgements.items.properties.candidate_id.enum, ['a', 'b'])
  assert.equal(schema.properties.judgements.minItems, 2)
})

test('probe descriptions are deduplicated, trimmed and capped', () => {
  assert.deepEqual(topics.normalizeProbes({ descriptions: [' A ', 'A', 'B', '', 7, 'C', 'D', 'E', 'F'] }), ['A', 'B', 'C', 'D', 'E'])
  assert.deepEqual(topics.normalizeProbes({}), [])
})

const match = (candidate_id, extra = {}) => ({ candidate_id, relevance: 2, role: 'supports', decision: 'suggested', event_id: null, publisher: 'Slator', ...extra })

test('readiness counts independent evidence: same-event reports once, weak or rejected never', () => {
  const thin = topics.topicReadiness([
    match('a', { event_id: 'e1' }), match('b', { event_id: 'e1', publisher: 'MultiLingual' }),
    match('c', { relevance: 1 }), match('d', { decision: 'rejected', relevance: 3 })
  ])
  assert.equal(thin.independent, 1)
  assert.equal(thin.publishers, 2)
  assert.equal(thin.ready, false)
  assert.ok(thin.gaps.includes('2 more independent sources needed'))
  assert.ok(thin.gaps.includes('No evidence that challenges the angle yet'))

  const single = topics.topicReadiness([match('a'), match('b'), match('c')])
  assert.equal(single.independent, 3)
  assert.equal(single.ready, false, 'one publisher is not enough')
  assert.ok(single.gaps.includes('Evidence comes from a single publisher so far'))

  const ready = topics.topicReadiness([
    match('a'), match('b', { role: 'data', publisher: 'Nimdzi' }),
    match('c', { role: 'contradicts', relevance: 0, decision: 'accepted', publisher: 'CSA' })
  ])
  assert.equal(ready.ready, true, 'an editor-accepted source counts whatever the model scored')
  assert.deepEqual(ready.roles, ['supports', 'contradicts', 'data'])
  assert.deepEqual(ready.gaps, [])
})

test('status moves only between watching and ready; paused and closed stay as the editor set them', () => {
  assert.equal(topics.nextTopicStatus('watching', true), 'ready')
  assert.equal(topics.nextTopicStatus('ready', false), 'watching')
  assert.equal(topics.nextTopicStatus('paused', true), 'paused')
  assert.equal(topics.nextTopicStatus('closed', true), 'closed')
})

test('composition preselects accepted sources first, otherwise the strongest useful ones, at most eight', () => {
  const many = Array.from({ length: 10 }, (_, i) => match(`s${i}`, { relevance: i % 2 ? 3 : 2, similarity: i / 10 }))
  const picked = topics.defaultCompositionSources(many)
  assert.equal(picked.length, 8)
  assert.deepEqual(picked.slice(0, 2), ['s9', 's7'])
  assert.deepEqual(topics.defaultCompositionSources([...many, match('mine', { decision: 'accepted', relevance: 1 })]), ['mine'])
  assert.deepEqual(topics.defaultCompositionSources([match('weak', { relevance: 1 })]), [])
})

test('the composition brief keeps the editor angle, every contribution and the evidence gaps', () => {
  const direction = topics.topicEditorialDirection(
    { title: 'MTPE rates', brief: 'Rates are collapsing for some pairs only.' },
    [{ title: 'Survey', role: 'data', contribution: 'Shows a 20% fall' }, { title: 'Picked', role: 'context', contribution: '' }],
    ['No evidence that challenges the angle yet']
  )
  for (const text of ['MTPE rates', 'Rates are collapsing for some pairs only.', '[Figures & data] Survey: Shows a 20% fall',
    'Picked: Selected by the editor.', 'No evidence that challenges the angle yet', 'do not invent interviews']) assert.ok(direction.includes(text), text)
})
