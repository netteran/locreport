const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
function load(file, dependencies = {}) {
  const m = { exports: {} }
  new Function('exports', 'require', 'module', ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX }
  }).outputText)(m.exports, id => dependencies[id] || require(id), m)
  return m.exports
}
const citations = load('lib/citationStyle.ts')
const url = 'https://publisher.test/report_(2026)?edition=2&lang=en#findings'

test('descriptive citations and uncited articles need no wording changes', () => {
  for (const content of [
    'An uncited editorial opinion.',
    `In [TAUS’s pricing report](<${url}>), costs rose.`,
    '[Our October briefing](/articles/october) explained [the pricing change](https://publisher.test/pricing).',
    '[Contents](#source)\n\nThe source was consulted.\n\n`[source](https://publisher.test)`\n\n```md\n[source](https://publisher.test)\n```',
    '\\[source](/articles/earlier)\n\n[source]: https://publisher.test'
  ]) assert.deepEqual(citations.unclearCitations(content), [])
})

test('vague citations are detected through Markdown formatting, references, lists and tables', () => {
  const markdown = `A claim ([**source**](<${url}>)), then [here][ref].
- [Source 2](https://publisher.test/second)
  - [Read more →](https://publisher.test/third)

| Evidence |
| --- |
| [1](https://publisher.test/fourth) |

[ref]: /articles/earlier
`
  assert.deepEqual(citations.unclearCitations(markdown), [
    { label: 'source', url }, { label: 'here', url: '/articles/earlier' },
    { label: 'Source 2', url: 'https://publisher.test/second' },
    { label: 'Read more →', url: 'https://publisher.test/third' },
    { label: '1', url: 'https://publisher.test/fourth' }
  ])
  assert.equal(citations.unclearCitations('<https://publisher.test/report>').length, 1)
  assert.equal(citations.unclearCitations(`[source](<${url}>) and [source](<${url}>)`).length, 1)
})

test('wording repair preserves every unique destination, including internal links and URL punctuation', () => {
  const first = `[source](<${url}>) and [here](/articles/october)`
  const after = `[our October briefing](/articles/october) discusses [the report](<${url}>)`
  assert.equal(citations.sameCitationDestinations(first, after), true)
  for (const changed of [after.replace('edition=2', 'edition=3'), after.replace('/articles/october', '/articles/november'), `[report](<${url}>)`, after + ' [new](https://other.test)']) {
    assert.equal(citations.sameCitationDestinations(first, changed), false)
  }
})

test('only vague output gets one additional request, with the completed draft and wording guidance', async () => {
  let calls = 0
  const first = { title: 'A report', content: `The costs rose ([source](<${url}>)).` }
  const improved = { title: 'A report', content: `The [pricing report](<${url}>) documents rising costs.` }
  const output = await citations.writeWithNaturalLinks(async repair => {
    calls++
    if (!repair) return first
    assert.equal(repair.previous, first)
    assert.match(repair.instruction, /Preserve the title, factual claims, numbers and all link destinations/)
    return improved
  }, draft => draft.content)
  assert.equal(output, improved)
  assert.equal(calls, 2)
  calls = 0
  assert.equal(await citations.writeWithNaturalLinks(async () => { calls++; return improved }, draft => draft.content), improved)
  assert.equal(calls, 1)
})

test('unfinished style improvement stays editable and never triggers an unbounded retry', async () => {
  let calls = 0
  const original = `[source](<${url}>)`
  assert.equal(await citations.writeWithNaturalLinks(async () => { calls++; return original }, text => text), original)
  assert.equal(calls, 2)
})

test('a failed wording request or changed destination retains the original draft', async () => {
  const original = `[source](<${url}>)`
  for (const repaired of [new Error('Model unavailable'), '[report](https://invented.test)', 'No link left.']) {
    const output = await citations.writeWithNaturalLinks(async repair => {
      if (!repair) return original
      if (repaired instanceof Error) throw repaired
      return repaired
    }, text => text)
    assert.equal(output, original)
  }
  await assert.rejects(citations.writeWithNaturalLinks(async () => { throw new Error('First generation failed') }, text => text), /First generation failed/)
})

test('editor guidance is advisory and disappears when the anchor becomes descriptive', () => {
  const React = require('react'), { renderToStaticMarkup } = require('react-dom/server')
  const { CitationWordingNote } = load('components/CitationWordingNote.tsx', { '@/lib/citationStyle': citations })
  const render = content => renderToStaticMarkup(React.createElement(CitationWordingNote, { content }))
  const note = render(`[source](<${url}>)`)
  assert.match(note, /role="note"/)
  assert.match(note, /1 source link has unclear text/)
  assert.match(note, /publisher, report name or relevant words/)
  assert.equal(render(`[the pricing report](<${url}>)`), '')
  assert.equal(render('An article without links.'), '')
})
