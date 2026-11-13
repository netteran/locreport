const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')

function load(file, dependencies = {}) {
  const m = { exports: {} }
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText
  new Function('exports', 'require', 'module', code)(m.exports, id => dependencies[id] || require(id), m)
  return m.exports
}

for (const urls of [['https://a.example/news'], ['https://a.example/news', 'https://b.example/news']]) {
  test(`publishes an uncited ${urls.length}-source article while retaining its evidence`, async () => {
    const calls = []
    const draft = { id: 'draft', composition_id: 'composition', content: '# Analysis\n\nGrounded analysis without links.' }
    const service = {
      from(table) {
        const q = {
          select() { return q }, eq() { return q }, limit() { return q },
          async single() { return { data: draft, error: null } },
          async maybeSingle() { return { data: null, error: null } },
          then(resolve, reject) {
            assert.equal(table, 'composition_sources')
            return Promise.resolve({ data: urls.map(source_url => ({ snapshot: { source_url } })), error: null }).then(resolve, reject)
          }
        }
        return q
      },
      async rpc(name, params) {
        calls.push({ name, params })
        return { data: 'article', error: null }
      }
    }
    const { approveDraft } = load('lib/publish.ts', {
      '@/lib/slugify': { slugify: () => 'analysis', uniqueSlug: async slug => slug },
      '@/lib/utils': { extractTeaser: () => 'Grounded analysis.' },
      '@/lib/classify': { classifyArticle: async () => ({}) },
      '@/lib/openai': { getOpenAI: () => ({}) },
      '@/lib/embeddings': { embedAndStoreArticle: async () => {} },
      '@/lib/factFlow': { ensureArticleFact: async () => { throw new Error('Composition must use existing facts') } },
      '@/lib/companyLinks': { getDirectoryEntries: async () => [], linkifyCompanyMentions: content => content },
      '@/lib/revalidate': { revalidateArticleSurfaces: () => {} },
      '@/lib/sourceName': { draftSourceName: async () => null },
      '@/lib/eventMatching': load('lib/eventMatching.ts')
    })
    const result = await approveDraft(service, draft.id)
    assert.equal(result.status, 'ok')
    assert.equal(calls.length, 1)
    assert.equal(calls[0].name, 'publish_editorial_draft')
    assert.equal(calls[0].params.p_article.content, draft.content)
    assert.deepEqual(calls[0].params.p_article.covered_urls, urls)
  })
}
