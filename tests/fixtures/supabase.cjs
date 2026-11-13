// Isolated HTTP fixture for builds/browser tests. It never forwards to a real Supabase project.
const http = require('node:http')
const port = Number(process.env.FIXTURE_PORT || 54329)
const factId = '10000000-0000-4000-8000-000000000001'
const articleId = '20000000-0000-4000-8000-000000000001'
const admin = {
  id: '90000000-0000-4000-8000-000000000001',
  email: 'editor@example.test',
  aud: 'authenticated',
  role: 'authenticated',
  created_at: '2026-01-01T00:00:00Z'
}
const facts = [
  {
    id: factId,
    content: 'A sourced industry announcement.',
    category: 'news',
    source_url: 'https://example.test/announcement',
    source_name: 'Primary source',
    article_id: articleId,
    event_id: null,
    created_at: '2026-11-13T09:00:00Z',
    published_at: '2026-11-13T09:00:00Z'
  }
]
http
  .createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`)
    let rows = []
    if (url.pathname === '/auth/v1/user') return reply(admin)
    if (url.pathname.includes('/facts')) {
      if (url.searchParams.get('status') !== 'eq.published')
        return reply({ message: 'Public fact reads must filter published status' }, 400)
      rows = facts
    }
    if (url.pathname.includes('/public_fact_sources'))
      rows = [
        {
          fact_id: factId,
          source_url: 'https://example.test/announcement',
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
    if (url.pathname.includes('/fact_article_links'))
      rows = [
        {
          fact_id: factId,
          articles: { id: articleId, slug: 'combined-analysis', title: 'Combined analysis' }
        }
      ]
    if (url.pathname.includes('/articles')) rows = []
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
  .listen(port, '127.0.0.1', () => console.log(`Supabase fixture listening on ${port}`))
