const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const fs = require('node:fs')
const { PGlite } = require('@electric-sql/pglite')
const { vector } = require('@electric-sql/pglite-pgvector')

let db, upgradeFixture
const uid = () => randomUUID()
const scalar = async (sql, args = []) => (await db.query(sql, args)).rows[0]
const event = (stage = 'announced') => ({
  subject: 'RWS',
  action: 'acquisition',
  object: 'Acolad',
  stage,
  event_date: '2026-11-13',
  headline: `RWS ${stage} an acquisition of Acolad.`,
  entities: ['rws', 'acolad']
})
async function source(trusted = false) {
  const id = uid()
  await db.query('insert into rss_sources(id,name,auto_publish) values($1,$2,$3)', [
    id,
    'Publisher',
    trusted
  ])
  return id
}
async function candidate(sourceId, extra = {}) {
  const id = uid()
  await db.query(
    `insert into source_candidates(id,title,source_url,source_feed_id,extracted_facts,quality,allow_auto_publish,source_name)
    values($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      id,
      extra.title || 'A source title',
      `https://example.org/${id}`,
      sourceId,
      extra.facts || 'A sourced fact sheet',
      extra.quality || 'full',
      extra.allow_auto_publish !== false,
      'Publisher'
    ]
  )
  return id
}
async function record(
  candidateId,
  key = uid(),
  eventId = null,
  relation = 'new',
  auto = true,
  descriptor = event()
) {
  return (
    await scalar('select record_candidate_event($1,$2,$3,$4,$5,$6) as id', [
      candidateId,
      eventId,
      key,
      JSON.stringify(descriptor),
      relation,
      auto
    ])
  ).id
}
before(async () => {
  db = new PGlite({ extensions: { vector } })
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table rss_sources(id uuid primary key default gen_random_uuid(),name text,kind text default 'feed',active boolean default true,auto_publish boolean default false);
    create table settings(key text primary key,value text);
    create table drafts(id uuid primary key default gen_random_uuid(),title text,slug text unique,content text,excerpt text,source_url text,
      source_feed_id uuid references rss_sources(id),source_published_at timestamptz,extracted_facts text,status text default 'pending',created_at timestamptz default now(),updated_at timestamptz default now());
    create table articles(id uuid primary key default gen_random_uuid(),title text,slug text unique,content text,excerpt text,source_url text,publisher text,
      image_url text,image_alt text,draft_id uuid references drafts(id),article_type text,author text,impact_score integer,time_horizon text,
      signal_ids text[],business_implications text[],affected_segments text[],published_at timestamptz default now());`)
  await db.exec(fs.readFileSync('supabase/migrations/20260624_create_facts.sql', 'utf8'))
  await db.exec(`insert into articles(id,title) values('00000000-0000-4000-8000-000000000001','Legacy article');
    insert into facts(content,article_id) values('Already public','00000000-0000-4000-8000-000000000001');
    insert into facts(content) values('Private pending fact');`)
  await db.exec(`insert into drafts(id,title,slug,content,source_url,extracted_facts) values
    ('00000000-0000-4000-8000-000000000002','Legacy source','legacy-source','Generated prose is not original evidence','https://legacy.example/news','Original extracted facts');
    insert into facts(content,draft_id) values('Old parked headline','00000000-0000-4000-8000-000000000002');`)
  await db.exec(fs.readFileSync('supabase/migrations/20261113_research_publications.sql', 'utf8'))
  const retained = await candidate(await source()), other = await candidate(await source()), comp = uid()
  await db.query('select reserve_composition($1,$2,$3)', [comp, [retained, other], uid()])
  upgradeFixture = { retained, other, comp }
  await db.exec(fs.readFileSync('supabase/migrations/20261114_single_source_articles.sql', 'utf8'))
  await db.exec(
    'grant usage on schema public to anon,authenticated,service_role;grant select on all tables in schema public to anon,authenticated;grant all on all tables in schema public to service_role;'
  )
})
after(async () => {
  if (db) await db.close()
})

test('migration preserves public facts and keeps parked facts private', async () => {
  assert.equal(
    (await scalar("select status from facts where content='Already public'")).status,
    'published'
  )
  assert.equal(
    (await scalar("select status from facts where content='Private pending fact'")).status,
    'pending'
  )
  const imported = await scalar(
    "select extracted_facts,allow_auto_publish from source_candidates where source_url='https://legacy.example/news'"
  )
  assert.equal(imported.extracted_facts, 'Original extracted facts')
  assert.equal(imported.allow_auto_publish, false)
  assert.equal(
    (await scalar("select research_only from drafts where slug='legacy-source'")).research_only,
    true
  )
  assert.equal(
    (await scalar("select status from facts where content='Old parked headline'")).status,
    'rejected'
  )
  await db.exec('set role anon')
  try {
    assert.equal((await scalar('select count(*)::int as n from facts')).n, 1)
    assert.equal((await scalar('select count(*)::int as n from source_candidates')).n, 0)
    await assert.rejects(db.query('select claim_research_lock($1)', [uid()]), /permission denied/)
  } finally {
    await db.exec('reset role')
  }
})

test('multiple trusted sources and concurrent retries produce one public event fact', async () => {
  const s = await source(true),
    a = await candidate(s),
    b = await candidate(s),
    key = uid()
  const ids = await Promise.all([record(a, key), record(b, key)])
  assert.equal(ids[0], ids[1])
  const fact = await scalar('select id,content,published_at from facts where event_id=$1', [ids[0]])
  await record(b, key, ids[0], 'same')
  const later = await scalar('select id,content,published_at from facts where event_id=$1', [
    ids[0]
  ])
  assert.deepEqual(later, fact)
  assert.equal(
    (await scalar('select count(*)::int n from event_sources where event_id=$1', [ids[0]])).n,
    2
  )
})

test('untrusted facts await review; trusted corroboration publishes without duplicating', async () => {
  const a = await candidate(await source()),
    eid = await record(a)
  assert.equal(
    (await scalar('select status from facts where event_id=$1', [eid])).status,
    'pending'
  )
  const b = await candidate(await source(true))
  await record(b, uid(), eid, 'same')
  assert.equal(
    (await scalar('select status from facts where event_id=$1', [eid])).status,
    'published'
  )
})

test('snippet-only evidence and imported backlog cannot auto-publish', async () => {
  const s = await source(true)
  for (const extra of [{ quality: 'snippet' }, { allow_auto_publish: false }]) {
    const eid = await record(await candidate(s, extra))
    assert.equal(
      (await scalar('select status from facts where event_id=$1', [eid])).status,
      'pending'
    )
  }
})

test('conflicts do not rewrite the headline or count as supporting evidence', async () => {
  const s = await source(true),
    eid = await record(await candidate(s))
  const old = await scalar('select content,published_at from facts where event_id=$1', [eid])
  const c = await candidate(s)
  await record(c, uid(), eid, 'conflict')
  assert.deepEqual(
    await scalar('select content,published_at from facts where event_id=$1', [eid]),
    old
  )
  assert.equal(
    (await scalar('select confirmed from event_sources where candidate_id=$1', [c])).confirmed,
    false
  )
  assert.equal(
    (await scalar('select review_required from industry_events where id=$1', [eid]))
      .review_required,
    true
  )
})

test('uncertain matches are held without creating a second event or fact', async () => {
  const s = await source(true),
    eid = await record(await candidate(s)),
    c = await candidate(s)
  assert.equal(await record(c, uid(), eid, 'uncertain'), null)
  const row = await scalar(
    'select event_id,suggested_event_id,review_reason from source_candidates where id=$1',
    [c]
  )
  assert.equal(row.event_id, null)
  assert.equal(row.suggested_event_id, eid)
  assert.match(row.review_reason, /Uncertain/)
})

test('compositions reserve evidence atomically; failed overlapping reservations leave no orphan', async () => {
  const s = await source(),
    a = await candidate(s),
    b = await candidate(s),
    c = await candidate(s),
    comp = uid(),
    bad = uid()
  await db.query('select reserve_composition($1,$2,$3)', [comp, [a, b], uid()])
  await assert.rejects(
    db.query('select reserve_composition($1,$2,$3)', [bad, [b, c], uid()]),
    /unavailable/
  )
  assert.equal((await scalar('select count(*)::int n from compositions where id=$1', [bad])).n, 0)
  await db.query('select abandon_composition($1)', [comp])
  assert.equal(
    (await scalar('select status from source_candidates where id=$1', [a])).status,
    'available'
  )
})

test('single-source migration preserves existing reservations and private function permissions', async () => {
  const { comp, retained, other } = upgradeFixture
  assert.equal((await scalar('select count(*)::int n from composition_sources where composition_id=$1', [comp])).n, 2)
  for (const id of [retained, other]) {
    assert.equal((await scalar('select reserved_by from source_candidates where id=$1', [id])).reserved_by, comp)
  }
  for (const fn of ['reserve_composition(uuid,uuid[],uuid)', 'replace_composition_sources(uuid,uuid[])']) {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      assert.equal((await scalar('select has_function_privilege($1,$2,$3) as allowed', [role, fn, 'EXECUTE'])).allowed, role === 'service_role')
    }
  }
})

test('single-source articles retain evidence, create pending drafts and publish only on explicit approval', async () => {
  const a = await candidate(await source(true)), eid = await record(a), comp = uid(), request = uid()
  const countBefore = (await scalar('select count(*)::int n from articles')).n
  await db.query('select reserve_composition($1,$2,$3)', [comp, [a], uid()])
  const snapshot = await scalar('select snapshot from composition_sources where composition_id=$1', [comp])
  assert.equal(snapshot.snapshot.id, a)
  assert.equal(snapshot.snapshot.extracted_facts, 'A sourced fact sheet')
  assert.equal((await scalar('select claim_composition_generation($1,$2) as ok', [comp, request])).ok, true)
  const url = snapshot.snapshot.source_url
  const { id: draft } = await scalar('select finish_composition_generation($1,$2,$3,$4,$5,$6) as id', [
    comp, request, 'Focused article', `An attributed article: [Publisher](${url}).`, 'single-' + comp, [url]
  ])
  assert.equal((await scalar('select status from drafts where id=$1', [draft])).status, 'pending')
  assert.equal((await scalar('select count(*)::int n from articles')).n, countBefore)
  const body = JSON.stringify({ title: 'Focused article', slug: 'single-' + comp, content: 'Article', covered_urls: [url] })
  const { id: article } = await scalar('select publish_editorial_draft($1,$2) as id', [draft, body])
  assert.equal((await scalar('select publish_editorial_draft($1,$2) as id', [draft, body])).id, article)
  assert.equal((await scalar('select status from source_candidates where id=$1', [a])).status, 'used')
  assert.equal((await scalar('select count(*)::int n from fact_article_links where fact_id in(select id from facts where event_id=$1) and article_id=$2', [eid, article])).n, 1)
})

test('compositions can change between multiple sources and one source without publishing a stale draft', async () => {
  const a = await candidate(await source()), b = await candidate(await source()), comp = uid(), request = uid()
  await db.query('select reserve_composition($1,$2,$3)', [comp, [a, b], uid()])
  await db.query('select claim_composition_generation($1,$2)', [comp, request])
  const { id: draft } = await scalar('select finish_composition_generation($1,$2,$3,$4,$5,$6) as id', [
    comp, request, 'Original', 'Body', 'replace-single-' + comp, []
  ])
  await db.query('select replace_composition_sources($1,$2)', [comp, [a]])
  assert.equal((await scalar('select count(*)::int n from composition_sources where composition_id=$1', [comp])).n, 1)
  assert.equal((await scalar('select status from source_candidates where id=$1', [b])).status, 'available')
  await assert.rejects(db.query('select publish_editorial_draft($1,$2)', [draft, JSON.stringify({ title: 'Stale', slug: 'stale-single-' + comp, content: 'Old' })]), /not ready/)
  await db.query('select replace_composition_sources($1,$2)', [comp, [a, b]])
  assert.equal((await scalar('select count(*)::int n from composition_sources where composition_id=$1', [comp])).n, 2)
  assert.equal((await scalar('select reserved_by from source_candidates where id=$1', [b])).reserved_by, comp)
})

test('one-source support still rejects empty, null, excessive and duplicated source selections atomically', async () => {
  const a = await candidate(await source()), comp = uid()
  for (const ids of [[], null, Array.from({ length: 9 }, uid), [a, a]]) {
    const bad = uid()
    await assert.rejects(db.query('select reserve_composition($1,$2,$3)', [bad, ids, uid()]), /Select 1–8|no longer exist/)
    assert.equal((await scalar('select count(*)::int n from compositions where id=$1', [bad])).n, 0)
  }
  await db.query('select reserve_composition($1,$2,$3)', [comp, [a], uid()])
  for (const ids of [[], null, Array.from({ length: 9 }, uid)]) {
    await assert.rejects(db.query('select replace_composition_sources($1,$2)', [comp, ids]), /Select 1–8/)
  }
  assert.equal((await scalar('select count(*)::int n from composition_sources where composition_id=$1', [comp])).n, 1)
})

test('manual generation and publication preserve source snapshots and are idempotent', async () => {
  const s = await source(true),
    a = await candidate(s),
    b = await candidate(s),
    e = await record(a),
    comp = uid(),
    request = uid()
  await db.query('select reserve_composition($1,$2,$3)', [comp, [a, b], uid()])
  const claims = await Promise.all([
    db.query('select claim_composition_generation($1,$2) as ok', [comp, request]),
    db.query('select claim_composition_generation($1,$2) as ok', [comp, request])
  ])
  assert.deepEqual(
    claims.map((r) => r.rows[0].ok),
    [true, false]
  )
  const url = (await scalar('select source_url from source_candidates where id=$1', [a])).source_url
  await assert.rejects(
    db.query('select finish_composition_generation($1,$2,$3,$4,$5,$6)', [
      comp,
      uid(),
      'Title',
      'Content',
      'wrong-token',
      [url]
    ]),
    /not generating/
  )
  const did = (
    await scalar('select finish_composition_generation($1,$2,$3,$4,$5,$6) as id', [
      comp,
      request,
      'Combined title',
      'Article content',
      'combined-' + comp,
      [url]
    ])
  ).id
  assert.equal((await scalar('select status from drafts where id=$1', [did])).status, 'pending')
  const body = JSON.stringify({
    title: 'Combined title',
    slug: 'published-' + comp,
    content: 'Article',
    covered_urls: [url],
    signal_ids: [],
    business_implications: [],
    affected_segments: []
  })
  const publications = await Promise.all([
    db.query('select publish_editorial_draft($1,$2) as id', [did, body]),
    db.query('select publish_editorial_draft($1,$2) as id', [did, body])
  ])
  const aid = publications[0].rows[0].id
  assert.equal(aid, publications[1].rows[0].id)
  assert.equal(
    (await scalar('select status from compositions where id=$1', [comp])).status,
    'published'
  )
  assert.equal(
    (await scalar('select status from source_candidates where id=$1', [a])).status,
    'used'
  )
  assert.equal(
    (await scalar('select count(*)::int n from fact_article_links where article_id=$1', [aid])).n,
    1
  )
  await db.query('delete from articles where id=$1', [aid])
  assert.equal(
    (await scalar('select status,article_id from facts where event_id=$1', [e])).status,
    'published'
  )
  assert.equal(
    (await scalar('select article_id from facts where event_id=$1', [e])).article_id,
    null
  )
})

test('merging duplicate events retains evidence and withdraws the duplicate permalink', async () => {
  const s = await source(true),
    a = await candidate(s),
    b = await candidate(s),
    from = await record(a),
    into = await record(b)
  await db.query('select merge_industry_events($1,$2)', [from, into])
  assert.equal(
    (await scalar('select count(*)::int n from event_sources where event_id=$1', [into])).n,
    2
  )
  assert.equal(
    (
      await scalar('select count(*)::int n from facts where event_id=$1 and status=$2', [
        into,
        'published'
      ])
    ).n,
    1
  )
  assert.equal(
    (await scalar('select event_id from source_candidates where id=$1', [a])).event_id,
    into
  )
})

test('changing evidence requires regeneration, releases removed inputs and preserves snapshots', async () => {
  const s = await source(),
    a = await candidate(s),
    b = await candidate(s),
    c = await candidate(s),
    comp = uid(),
    req = uid()
  await db.query('select reserve_composition($1,$2,$3)', [comp, [a, b], uid()])
  await db.query('select claim_composition_generation($1,$2)', [comp, req])
  const did = (
    await scalar('select finish_composition_generation($1,$2,$3,$4,$5,$6) as id', [
      comp,
      req,
      'Analysis',
      'Body',
      'change-' + comp,
      []
    ])
  ).id
  await db.query('update source_candidates set extracted_facts=$1 where id=$2', [
    'Later edited facts',
    a
  ])
  await db.query('select replace_composition_sources($1,$2)', [comp, [a, c]])
  assert.equal(
    (await scalar('select status from compositions where id=$1', [comp])).status,
    'editing'
  )
  assert.equal(
    (await scalar('select status from source_candidates where id=$1', [b])).status,
    'available'
  )
  assert.equal(
    (
      await scalar(
        "select snapshot->>'extracted_facts' as facts from composition_sources where composition_id=$1 and candidate_id=$2",
        [comp, a]
      )
    ).facts,
    'A sourced fact sheet'
  )
  await assert.rejects(
    db.query('select publish_editorial_draft($1,$2)', [
      did,
      JSON.stringify({ title: 'Stale', slug: 'stale-' + comp, content: 'Body' })
    ]),
    /not ready/
  )
})

test('a late-published fact gains existing analysis links without another article or fact', async () => {
  const s = await source(),
    a = await candidate(s),
    b = await candidate(s),
    eid = await record(a),
    comp = uid(),
    req = uid()
  await db.query('select reserve_composition($1,$2,$3)', [comp, [a, b], uid()])
  await db.query('select claim_composition_generation($1,$2)', [comp, req])
  const url = (await scalar('select source_url from source_candidates where id=$1', [a])).source_url
  const did = (
    await scalar('select finish_composition_generation($1,$2,$3,$4,$5,$6) as id', [
      comp,
      req,
      'Analysis',
      'Body',
      'late-' + comp,
      [url]
    ])
  ).id
  const article = await scalar('select publish_editorial_draft($1,$2) as id', [
    did,
    JSON.stringify({
      title: 'Analysis',
      slug: 'late-published-' + comp,
      content: 'Body',
      covered_urls: [url]
    })
  ])
  assert.equal(
    (
      await scalar('select count(*)::int n from fact_article_links where article_id=$1', [
        article.id
      ])
    ).n,
    0
  )
  await db.query("update facts set status='published',published_at=now() where event_id=$1", [eid])
  assert.equal(
    (
      await scalar('select count(*)::int n from fact_article_links where article_id=$1', [
        article.id
      ])
    ).n,
    1
  )
  await db.exec('set role authenticated')
  try {
    await assert.rejects(
      db.query('select claim_composition_generation($1,$2)', [comp, uid()]),
      /permission denied/
    )
  } finally {
    await db.exec('reset role')
  }
})

test('fresh coverage adopts an existing legacy fact without republishing or resetting its time', async () => {
  const legacyId = uid(),
    s = await source(true),
    c = await candidate(s),
    key = uid()
  await db.query(
    "insert into facts(id,content,source_url,status,published_at) values($1,$2,$3,'published','2026-11-12T09:00:00Z')",
    [legacyId, 'The previously published acquisition fact.', 'https://primary.example/deal']
  )
  const before = await scalar('select content,published_at from facts where id=$1', [legacyId])
  const eid = (
    await scalar('select record_candidate_event($1,null,$2,$3,$4,true,$5) as id', [
      c,
      key,
      JSON.stringify(event()),
      'same',
      legacyId
    ])
  ).id
  assert.deepEqual(
    await scalar('select content,published_at from facts where id=$1', [legacyId]),
    before
  )
  assert.equal((await scalar('select count(*)::int n from facts where event_id=$1', [eid])).n, 1)
  assert.equal((await scalar('select event_id from facts where id=$1', [legacyId])).event_id, eid)
})
