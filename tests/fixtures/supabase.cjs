// Isolated HTTP fixture. No mode forwards requests to a real project.
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

// Optional populated mode for public editorial browser checks. Default research
// and legacy fixtures remain deliberately sparse for their existing callers.
const editorialArticles = [
  ...[
    ['Newest authored analysis', 'newest-authored-analysis', '2026-11-16', 1],
    ['Combined analysis', 'combined-analysis', '2026-11-15', 2],
    ['A buyer workflow decision', 'buyer-workflow-decision', '2026-11-13', 3],
    ['Legacy mindsets, enterprise AI buying decisions, and dynamic orchestration in localization', 'language-technology-in-practice', '2026-11-11', 4],
    ['Older high-impact analysis', 'older-high-impact-analysis', '2026-11-08', 5],
  ].map(([title, slug, day, impact_score], index) => ({
    id: index === 1 ? articleId : `20000000-0000-4000-8000-${String(index + 10).padStart(12, '0')}`,
    title,
    slug,
    excerpt: index === 1
      ? 'Localization leaders are reassessing where language expertise fits in enterprise AI buying decisions. Across recent industry discussions, the recurring questions concern quality, governance and the operational work that connects a promising model to a dependable service. This analysis brings those perspectives together, examines the evidence behind competing claims, and considers what changes for buyers, technology providers and language professionals. A longer introduction should remain readable without leaving an empty column beneath its thumbnail.'
      : 'Editorial perspective grounded in multiple industry sources.',
    content: index === 0 ? `> Language expertise becomes useful when it informs the whole decision, not just the translation.

A practical editorial analysis of language services, grounded in evidence and the experience of the people doing the work.

## Put the evidence in context

The next step is to connect individual announcements with the choices buyers and language professionals actually face.

> A reported improvement is a starting point for a conversation, not a substitute for evaluation.
>
> A second paragraph should feel like part of the same quotation.
>
> <cite>Industry discussion, quoted for this isolated preview</cite>

### Three questions worth asking

- **Quality and evaluation.** Define what a useful improvement would look like in the actual workflow.
  - Include subject specialists in the review.
  - Check more than the easiest language pair.
- **Operational fit.** Look at the work around the model as well as the model itself.
- **Commercial context.** Make responsibilities and assumptions explicit.

A list can also contain several paragraphs in one item:

- Start with the available evidence.

  Explain its limits before drawing a conclusion. Links to [supporting material](https://example.test/evidence) should remain easy to identify.

- Compare the result with the alternatives.

  Retain context when a result is uncertain.

### A practical sequence

1. Agree on the decision to be made.
2. Test the proposed workflow.
   1. Use representative material.
   2. Record the exceptions.
3. Review the evidence with the people affected.

Conclusions should remain connected to the evidence, with room for an informed disagreement.`
      : 'A practical editorial analysis of language services.\n\nThe evidence informs a buyer decision.',
    article_type: 'industry',
    author: 'LocReport Editorial',
    publisher: 'LocReport',
    source_url: null,
    image_url: index === 0 ? '/og-image.jpg' : index === 1 ? '/og-factflow.png' : index === 3 ? '/icon.png' : null,
    image_alt: null,
    signal_ids: ['quality-gap-closure'],
    impact_score,
    time_horizon: '6months',
    affected_segments: ['Buyers'],
    business_implications: ['Evaluate evidence before changing a workflow.'],
    tags: ['localization'],
    published_at: `${day}T10:00:00Z`,
    updated_at: `${day}T10:00:00Z`,
    embedding: null,
  })),
  {
    id: '20000000-0000-4000-8000-000000000020',
    title: 'October: the evidence behind buyer decisions',
    slug: 'october-buyer-decisions-briefing',
    excerpt: 'What mattered in October, its implications and the questions to watch.',
    content: 'An October assessment.\n\nThe evidence informs a buyer decision.',
    article_type: 'monthly-summary',
    monthly_period: '2026-10',
    report_start_date: '2026-10-01',
    report_end_date: '2026-10-31',
    author: 'LocReport Editorial',
    publisher: 'LocReport',
    source_url: null,
    image_url: null,
    image_alt: null,
    signal_ids: ['quality-gap-closure'],
    impact_score: 5,
    business_implications: [],
    affected_segments: [],
    tags: [],
    published_at: '2026-11-17T10:00:00Z',
    updated_at: '2026-11-17T10:00:00Z',
  },
]

function selectEditorialArticles(url) {
  let rows = [...editorialArticles]
  for (const key of ['id', 'slug', 'article_type', 'published_at']) {
    const filter = url.searchParams.get(key)
    if (!filter) continue
    if (filter.startsWith('eq.')) rows = rows.filter(row => row[key] === filter.slice(3))
    if (filter.startsWith('neq.')) rows = rows.filter(row => row[key] !== filter.slice(4))
    if (filter.startsWith('gte.')) rows = rows.filter(row => row[key] >= filter.slice(4))
    if (filter.startsWith('lt.')) rows = rows.filter(row => row[key] < filter.slice(3))
    if (filter.startsWith('in.(')) {
      const values = filter.slice(4, -1).split(',')
      rows = rows.filter(row => values.includes(row[key]))
    }
  }
  const order = url.searchParams.get('order') || 'published_at.desc'
  const [column, direction] = order.split('.')
  rows.sort((a, b) => String(a[column] ?? '').localeCompare(String(b[column] ?? '')) * (direction === 'asc' ? 1 : -1))
  const total = rows.length
  const offset = Number(url.searchParams.get('offset') || 0)
  const limit = Number(url.searchParams.get('limit') || total)
  return { rows: rows.slice(offset, offset + limit), total }
}

function createFixtureServer(schema = 'research', requests = []) {
  const newsletterNotes = new Map()
  const newsletterEditions = new Map()
  const factRows = [publicFact, independentFact, privateFact].map(f => ({...f}))
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    requests.push({
      method: req.method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams)
    })
    let rows = []
    let total
    if (url.pathname === '/auth/v1/user') return reply(admin)
    if (url.pathname === '/rest/v1/weekly_newsletter_editions') {
      if (schema === 'legacy') return reply({code:'42P01',message:'weekly_newsletter_editions does not exist'},404)
      if (req.method === 'POST') {
        let body = ''; req.on('data', c => {body += c}); req.on('end', () => {
          const row = JSON.parse(body); newsletterEditions.set(row.edition_date,row); reply(null)
        }); return
      }
      const date = (url.searchParams.get('edition_date') || '').replace(/^eq\./,'')
      rows = newsletterEditions.has(date) ? [newsletterEditions.get(date)] : []
    }
    if (url.pathname === '/rest/v1/weekly_newsletter_notes') {
      if (req.method === 'POST') {
        let body = ''
        req.on('data', chunk => { body += chunk })
        req.on('end', () => {
          const row = JSON.parse(body)
          newsletterNotes.set(row.edition_date, row)
          reply(null)
        })
        return
      }
      const date = (url.searchParams.get('edition_date') || '').replace(/^eq\./, '')
      const note = newsletterNotes.get(date)
      rows = note ? [note] : []
    }
    if (url.pathname === '/rest/v1/facts') {
      const id = (url.searchParams.get('id') || '').replace(/^eq\./,'')
      if (req.method === 'PATCH') {
        let body = ''; req.on('data', c => {body += c}); req.on('end', () => {
          const row = factRows.find(f => f.id === id); if(row) Object.assign(row,JSON.parse(body)); reply(null)
        }); return
      }
      if (id) { rows = factRows.filter(f => f.id === id); return reply(req.headers.accept?.includes('vnd.pgrst.object') ? rows[0] || null : rows) }

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
      } else if (req.headers.apikey === 'fixture-service') {
        rows = factRows.filter(f => !url.searchParams.has('status') || f.status === url.searchParams.get('status').slice(3))
      } else {
        if (
          url.searchParams.get('status') !== 'eq.published' &&
          url.searchParams.get('limit') !== '0'
        )
          return reply({ message: 'Public fact reads must filter published status' }, 400)
        rows =
          url.searchParams.get('limit') === '0'
            ? []
            : factRows.filter((f) => f.status === 'published')
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
          article_id: articleId,
          articles: { id: articleId, slug: 'combined-analysis', title: 'Combined analysis' }
        }
      ]
    }
    if (url.pathname === '/rest/v1/articles') {
      if (schema === 'legacy') {
        const column = (url.searchParams.get('select') || '').split(',').map(value => value.trim())
          .find(value => ['monthly_period', 'report_start_date', 'report_end_date'].includes(value))
        if (column) return reply({ code: '42703', message: `column articles.${column} does not exist` }, 400)
      }
      if (schema === 'editorial') {
        const result = selectEditorialArticles(url)
        rows = result.rows
        total = result.total
      } else {
        rows =
          schema === 'legacy' && url.searchParams.has('id')
            ? [{ id: articleId, slug: 'combined-analysis', title: 'Combined analysis' }]
            : []
      }
    }
    if (schema === 'editorial' && url.pathname === '/rest/v1/rpc/keyword_search_articles') {
      let body = ''
      req.on('data', chunk => { body += chunk })
      req.on('end', () => {
        const query = String(JSON.parse(body).query_text || '').toLowerCase()
        rows = editorialArticles.filter(row => `${row.title} ${row.excerpt}`.toLowerCase().includes(query))
        reply(rows)
      })
      return
    }
    if (req.method === 'HEAD') {
      res.writeHead(200, { 'Content-Range': `0-0/${total ?? 0}` })
      return res.end()
    }
    return reply(req.headers.accept?.includes('vnd.pgrst.object') ? rows[0] || null : rows)
    function reply(data, status = 200) {
      res.writeHead(status, {
        'Content-Type': 'application/json',
        'Content-Range': `0-${Math.max(0, rows.length - 1)}/${total ?? rows.length}`
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
