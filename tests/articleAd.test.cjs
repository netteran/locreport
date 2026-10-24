const { test } = require('node:test')
const assert = require('node:assert/strict')
const ts = require('typescript')
const fs = require('node:fs')
const source = fs.readFileSync('lib/articleAd.ts', 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
const compiledModule = { exports: {} }
new Function('exports', 'require', 'module', compiled)(compiledModule.exports, require, compiledModule)
const { splitArticleForAd } = compiledModule.exports

test('inserts after the first complete body paragraph and preserves inline links', () => {
  const html = '<h2>Introduction</h2><p>First <a href="https://example.com" target="_blank" rel="noopener">link</a>.</p><p>Second.</p>'
  const parts = splitArticleForAd(html)
  assert.equal(parts.before, html.slice(0, html.lastIndexOf('<p>')))
  assert.equal(parts.after, '<p>Second.</p>')
})

test('does not split nested paragraphs in quotes, lists, or tables', () => {
  const prefix = '<blockquote><p>Quote.</p></blockquote><ul><li><p>List.</p></li></ul><table><tbody><tr><td><p>Cell.</p></td></tr></tbody></table>'
  const parts = splitArticleForAd(prefix + '<p>First.</p><h2>Details</h2><p>Second.</p>')
  assert.equal(parts.before, prefix + '<p>First.</p>')
  assert.equal(parts.after, '<h2>Details</h2><p>Second.</p>')
})

test('skips short articles and articles with only nested paragraphs', () => {
  for (const html of ['', '<p>Only paragraph.</p>', '<blockquote><p>One.</p><p>Two.</p></blockquote>', '<p>One.</p><ul><li><p>Nested.</p></li></ul>']) {
    assert.equal(splitArticleForAd(html), null)
  }
})
