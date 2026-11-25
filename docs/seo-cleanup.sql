-- SEO archive cleanup: review queries (READ-ONLY) plus an apply template.
--
-- Context: Search Console (Nov 2026) shows ~1,550 articles "Crawled – currently
-- not indexed" and Google crawling only to refresh known URLs. The fix is a
-- smaller, stronger archive: merge duplicate stories and noindex thin briefs.
--
-- Run each SELECT in the Supabase SQL editor and export the result (Download CSV).
-- Nothing above section 4 changes data. Section 4 needs migration
-- 20261202_article_noindex.sql applied first.

-- ── 0. Archive overview ─────────────────────────────────────────────────────
select
  coalesce(content_type, 'analysis') as content_type,
  count(*) as articles,
  round(avg(array_length(regexp_split_to_array(trim(content), '\s+'), 1))) as avg_words,
  count(*) filter (where array_length(regexp_split_to_array(trim(content), '\s+'), 1) < 250) as under_250_words,
  count(*) filter (where impact_score <= 2) as impact_1_or_2
from articles
where published_at is not null
group by 1
order by 2 desc;

-- ── 1. Same original source published more than once ────────────────────────
-- The most reliable duplicate signal: two articles written from one source URL.
-- Keep the stronger copy (usually the longer / better-titled one); noindex or
-- delete the rest.
select
  a.source_url,
  count(*) as copies,
  string_agg(
    format('%s | %s | %s words | %s', a.id, a.title,
      array_length(regexp_split_to_array(trim(a.content), '\s+'), 1), a.published_at::date),
    E'\n' order by a.published_at
  ) as articles
from articles a
where a.published_at is not null
  and a.source_url is not null and a.source_url <> ''
  and a.article_type is distinct from 'monthly-summary'
group by a.source_url
having count(*) > 1
order by copies desc, a.source_url;

-- ── 2. "-1", "-2" slug pairs ───────────────────────────────────────────────
-- A numeric suffix is added when a new article's headline slug already existed.
-- That is not proof of a duplicate (the earlier one may be a legacy dated slug),
-- so compare titles, sources and dates side by side.
with suffixed as (
  select id, title, slug, content_slug, source_url, published_at,
         regexp_replace(content_slug, '-\d+$', '') as base
  from articles
  where published_at is not null and content_slug ~ '-\d+$'
)
select
  s.content_slug as suffixed_slug,
  s.title as suffixed_title,
  s.published_at::date as suffixed_date,
  b.slug as base_slug,
  b.title as base_title,
  b.published_at::date as base_date,
  (s.source_url is not distinct from b.source_url) as same_source,
  (lower(s.title) = lower(b.title)) as same_title,
  s.id as suffixed_id,
  b.id as base_id
from suffixed s
left join articles b
  on b.id <> s.id
 and b.published_at is not null
 and (b.content_slug = s.base or split_part(b.slug, '/', -1) = s.base)
order by (b.id is null), same_source desc, same_title desc, s.published_at desc;

-- ── 3. Pruning candidates ──────────────────────────────────────────────────
-- Every published story with the signals that make it weak in Google's eyes.
-- `suggestion` is a starting point for a human decision, not a verdict:
--   noindex  = short brief with low impact, or an off-topic/aggregator source
--   review   = short or low impact, look at it
--   keep     = substantial, or analysis with real length
select
  a.id,
  coalesce(a.content_type, 'analysis') as content_type,
  a.title,
  a.content_slug,
  a.published_at::date as published,
  array_length(regexp_split_to_array(trim(a.content), '\s+'), 1) as words,
  a.impact_score,
  s.name as feed,
  (s.name like 'Google News%' or a.source_url like '%news.google.com%') as via_google_news,
  (select count(*) from regexp_matches(a.content, '\]\(https?://', 'g')) as external_links,
  case
    when array_length(regexp_split_to_array(trim(a.content), '\s+'), 1) < 250
         and coalesce(a.impact_score, 0) <= 2 then 'noindex'
    when s.name in ('Google Blog', 'Google Blog Models and Research') then 'noindex'
    when array_length(regexp_split_to_array(trim(a.content), '\s+'), 1) < 250
         or coalesce(a.impact_score, 0) <= 2 then 'review'
    else 'keep'
  end as suggestion
from articles a
left join drafts d on d.id = a.draft_id
left join rss_sources s on s.id = d.source_feed_id
where a.published_at is not null
  and a.article_type is distinct from 'monthly-summary'
order by
  case
    when array_length(regexp_split_to_array(trim(a.content), '\s+'), 1) < 250
         and coalesce(a.impact_score, 0) <= 2 then 1
    when s.name in ('Google Blog', 'Google Blog Models and Research') then 1
    when array_length(regexp_split_to_array(trim(a.content), '\s+'), 1) < 250
         or coalesce(a.impact_score, 0) <= 2 then 2
    else 3
  end,
  words nulls first;

-- ── 4. APPLY (changes data) ────────────────────────────────────────────────
-- After reviewing the exports, paste the chosen article ids. Noindex keeps the
-- page readable on LocReport and drops it from the sitemap and search.
-- Single articles can also be toggled in /admin/articles/[id].
--
-- update articles set noindex = true
-- where id in (
--   '00000000-0000-0000-0000-000000000000'
-- );
--
-- Check the result:
-- select count(*) filter (where noindex) as noindexed, count(*) as total
-- from articles where published_at is not null;
--
-- To undo one: update articles set noindex = false where id = '…';

-- ── 5. Recommended pruning (from the Nov 2026 export of section 3) ──────────
-- The export showed impact_score cannot separate strong from weak stories (1,225 of
-- 1,483 are scored 2), so these rules use length, provenance and duplication.
-- Run the PREVIEW first; every UPDATE is reversible (set noindex = false).
--
-- Tier 1 — clear-cut (≈231 articles):
--   • under 250 words
--   • raw Google News titles ending " - Outlet" (older pipeline; includes off-topic
--     items such as Louisiana State Police "LSP" crime stories)
--   • from the Google Blog feeds (general Google product news)
--   • exact-duplicate titles: all but the longest copy
-- Tier 2 — every remaining brief (≈1,076): single-source rewrites of 250–600 words,
--   the class Google has stopped indexing. They stay readable on LocReport.
-- Left indexed: analysis of 250+ words (≈176), reports, directory, tools.

-- PREVIEW: how many each tier would touch (read-only)
with base as (
  select a.id, a.title, coalesce(a.content_type, 'analysis') as content_type,
         array_length(regexp_split_to_array(trim(a.content), '\s+'), 1) as words,
         s.name as feed,
         row_number() over (
           partition by trim(lower(regexp_replace(a.title, '\W+', ' ', 'g')))
           order by array_length(regexp_split_to_array(trim(a.content), '\s+'), 1) desc, a.published_at
         ) as title_rank
  from articles a
  left join drafts d on d.id = a.draft_id
  left join rss_sources s on s.id = d.source_feed_id
  where a.published_at is not null and a.article_type is distinct from 'monthly-summary'
), tiered as (
  select *, case
    when words < 250 or title ~ ' - [A-Z][^-]{1,40}$'
      or feed like 'Google Blog%' or title_rank > 1 then 'tier1'
    when content_type = 'brief' then 'tier2'
    else 'keep'
  end as tier
  from base
)
select tier, count(*) from tiered group by tier order by tier;

-- PREVIEW the actual tier 1 rows before applying (read-only)
with base as (
  select a.id, a.title, coalesce(a.content_type, 'analysis') as content_type,
         array_length(regexp_split_to_array(trim(a.content), '\s+'), 1) as words,
         s.name as feed,
         row_number() over (
           partition by trim(lower(regexp_replace(a.title, '\W+', ' ', 'g')))
           order by array_length(regexp_split_to_array(trim(a.content), '\s+'), 1) desc, a.published_at
         ) as title_rank
  from articles a
  left join drafts d on d.id = a.draft_id
  left join rss_sources s on s.id = d.source_feed_id
  where a.published_at is not null and a.article_type is distinct from 'monthly-summary'
), tiered as (
  select *, case
    when words < 250 or title ~ ' - [A-Z][^-]{1,40}$'
      or feed like 'Google Blog%' or title_rank > 1 then 'tier1'
    when content_type = 'brief' then 'tier2'
    else 'keep'
  end as tier
  from base
)
select tier, id, title, content_type, words, feed from tiered where tier = 'tier1' order by words;

-- APPLY tier 1 (uncomment the whole statement):
-- with base as (
--   select a.id, a.title, coalesce(a.content_type, 'analysis') as content_type,
--          array_length(regexp_split_to_array(trim(a.content), '\s+'), 1) as words,
--          s.name as feed,
--          row_number() over (
--            partition by trim(lower(regexp_replace(a.title, '\W+', ' ', 'g')))
--            order by array_length(regexp_split_to_array(trim(a.content), '\s+'), 1) desc, a.published_at
--          ) as title_rank
--   from articles a
--   left join drafts d on d.id = a.draft_id
--   left join rss_sources s on s.id = d.source_feed_id
--   where a.published_at is not null and a.article_type is distinct from 'monthly-summary'
-- ), tiered as (
--   select *, case
--     when words < 250 or title ~ ' - [A-Z][^-]{1,40}$'
--       or feed like 'Google Blog%' or title_rank > 1 then 'tier1'
--     when content_type = 'brief' then 'tier2'
--     else 'keep'
--   end as tier
--   from base
-- )
-- update articles set noindex = true where id in (select id from tiered where tier = 'tier1');

-- APPLY tier 2, after tier 1, if you choose to (uncomment the whole statement):
-- with base as (
--   select a.id, a.title, coalesce(a.content_type, 'analysis') as content_type,
--          array_length(regexp_split_to_array(trim(a.content), '\s+'), 1) as words,
--          s.name as feed,
--          row_number() over (
--            partition by trim(lower(regexp_replace(a.title, '\W+', ' ', 'g')))
--            order by array_length(regexp_split_to_array(trim(a.content), '\s+'), 1) desc, a.published_at
--          ) as title_rank
--   from articles a
--   left join drafts d on d.id = a.draft_id
--   left join rss_sources s on s.id = d.source_feed_id
--   where a.published_at is not null and a.article_type is distinct from 'monthly-summary'
-- ), tiered as (
--   select *, case
--     when words < 250 or title ~ ' - [A-Z][^-]{1,40}$'
--       or feed like 'Google Blog%' or title_rank > 1 then 'tier1'
--     when content_type = 'brief' then 'tier2'
--     else 'keep'
--   end as tier
--   from base
-- )
-- update articles set noindex = true where id in (select id from tiered where tier = 'tier2');
