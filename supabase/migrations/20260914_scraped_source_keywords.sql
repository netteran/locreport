-- Ingest-level keyword filter carried on a generated feed, so promoting it to an
-- rss_sources row reproduces the same filtering the Sources form offers.
-- Distinct from content_filter.keywords, which gates items during generation.
alter table scraped_sources
  add column if not exists keywords text[] not null default '{}';

comment on column scraped_sources.keywords is
  'Copied to rss_sources.keywords when this feed is added to Sources. Applied by /api/ingest against title + full article text. Not used during feed generation — that is content_filter.';
