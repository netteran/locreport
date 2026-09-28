-- Fetch health per source, written by /api/ingest on every run. fetchFeed()
-- returns an empty list on any HTTP or parse error, so a dead feed looked
-- exactly like a quiet one: ATA Industry News sat active for four months with
-- zero drafts while its URL returned nothing. /admin/sources shows these.
alter table rss_sources
  add column if not exists last_fetch_at timestamptz,
  add column if not exists last_fetch_error text,
  add column if not exists last_fetch_items int,
  add column if not exists last_fetch_newest_at timestamptz;

comment on column rss_sources.last_fetch_error is
  'Why the last ingest fetch failed (e.g. "HTTP 404", an XML parse error); null when it succeeded.';
comment on column rss_sources.last_fetch_newest_at is
  'pubDate of the newest item in the last successful fetch — a feed that parses but has not moved in months is probably obsolete.';
