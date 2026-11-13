// Isolated HTTP fixture. Neither schema mode forwards requests to a real project.
const http = require('node:http')
const factId = '10000000-0000-4000-8000-000000000001'
const articleId = '20000000-0000-4000-8000-000000000001'
const admin = {
  id: '90000000-0000-4000-8000-000000000001',
  email: 'editor@example.test',
  aud: 'authenticated',
  role: 'authenticated',
  created_at: '2026-01-01T00:00:00Z'
}
const publicFact = {
  id: factId,
  content: 'A sourced industry announcement.',
  category: 'news',
  source_url: 'https://example.test/announcement',
  source_name: 'Primary source',
  article_id: articleId,
  event_id: null,
  status: 'published',
  created_at: '2026-11-13T09:00:00Z',
  published_at: '2026-11-13T09:00:00Z'
}
const independentFact = {
  ...publicFact,
  id: '10000000-0000-4000-8000-000000000002',
  content: 'An independent published news fact.',
  article_id: null
}
const privateFact = {
  ...publicFact,
  id: '10000000-0000-4000-8000-000000000003',
  content: 'Private pending fact',
  status: 'pending',
  article_id: null
}

function createFixtureServer(schema = 'research', requests = []) {
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    requests.push({
      method: req.method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams)
    })
    let rows = []
    if (url.pathname === '/auth/v1/user') return reply(admin)
    if (url.pathname === '/rest/v1/facts') {
      if (schema === 'legacy') {
        const column =
          (url.searchParams.get('select') || '')
            .split(',')
            .find((c) => ['event_id', 'published_at', 'status'].includes(c)) ||
          (url.searchParams.has('status') ? 'status' : null)
        if (column)
          return reply({ code: '42703', message: `column facts.${column} does not exist` }, 400)
        if (url.searchParams.get('article_id') !== 'not.is.null')
          return reply({ message: 'Legacy reads must exclude unlinked facts' }, 400)
        rows = [publicFact, privateFact]
          .filter((f) => f.article_id)
          .map(({ event_id, status, published_at, ...legacy }) => legacy)
      } else {
        if (
          url.searchParams.get('status') !== 'eq.published' &&
          url.searchParams.get('limit') !== '0'
        )
          return reply({ message: 'Public fact reads must filter published status' }, 400)
        rows =
          url.searchParams.get('limit') === '0'
            ? []
            : [publicFact, independentFact, privateFact].filter((f) => f.status === 'published')
      }
    }
    if (url.pathname === '/rest/v1/public_fact_sources') {
      if (schema === 'legacy')
        return reply({ code: 'PGRST205', message: 'public_fact_sources does not exist' }, 404)
      rows = [
        {
          fact_id: factId,
          source_url: publicFact.source_url,
          source_name: 'Primary source',
          title: 'Original announcement'
        },
        {
          fact_id: factId,
          source_url: 'https://other.example.test/coverage',
          source_name: 'Industry publication',
          title: 'Additional coverage'
        }
      ]
    }
    if (url.pathname === '/rest/v1/fact_article_links') {
      if (schema === 'legacy')
        return reply({ code: 'PGRST205', message: 'fact_article_links does not exist' }, 404)
      rows = [
        {
          fact_id: factId,
          articles: { id: articleId, slug: 'combined-analysis', title: 'Combined analysis' }
        }
      ]
    }
    if (url.pathname === '/rest/v1/articles') {
      rows =
        schema === 'legacy' && url.searchParams.has('id')
          ? [{ id: articleId, slug: 'combined-analysis', title: 'Combined analysis' }]
          : []
    }
    if (req.method === 'HEAD') {
      res.writeHead(200, { 'Content-Range': '0-0/0' })
      return res.end()
    }
    return reply(req.headers.accept?.includes('vnd.pgrst.object') ? rows[0] || null : rows)
    function reply(data, status = 200) {
      res.writeHead(status, {
        'Content-Type': 'application/json',
        'Content-Range': `0-${Math.max(0, rows.length - 1)}/${rows.length}`
      })
      res.end(JSON.stringify(data))
    }
  })
}
module.exports = { createFixtureServer }
if (require.main === module) {
  const port = Number(process.env.FIXTURE_PORT || 54329)
  const schema = process.env.FIXTURE_SCHEMA || 'research'
  createFixtureServer(schema).listen(port, '127.0.0.1', () =>
    console.log(`Supabase ${schema} fixture listening on ${port}`)
  )
}
