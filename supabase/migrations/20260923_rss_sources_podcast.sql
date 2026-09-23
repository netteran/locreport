-- Podcast sources: an rss_sources row whose feed is a podcast (audio RSS, or a
-- YouTube channel feed) rather than a news feed. They are deliberately
-- MANUAL-ONLY: /api/ingest (the scheduled GitHub Actions run and every batch
-- button) skips kind = 'podcast' rows, and the only thing that reads them is
-- /api/podcasts/[id]/ingest, which accepts an admin session only (never
-- CRON_SECRET) and only ever creates a pending draft — auto_publish is ignored.
-- Transcribing and writing up an episode costs real tokens, so it only happens
-- when a human clicks "Generate draft" on /admin/sources.
alter table rss_sources
  add column if not exists kind text not null default 'feed',
  add column if not exists podcast_config jsonb;

alter table rss_sources
  drop constraint if exists rss_sources_kind_check;
alter table rss_sources
  add constraint rss_sources_kind_check check (kind in ('feed', 'podcast'));

comment on column rss_sources.kind is
  '''feed'' = ordinary news feed read by /api/ingest. ''podcast'' = manual-only: skipped by /api/ingest, drafted one episode at a time from /admin/sources via /api/podcasts/[id]/ingest.';
comment on column rss_sources.podcast_config is
  'kind = ''podcast'' only. Show name, platform links (Spotify/YouTube/Apple), YouTube channel id for matching episodes to videos, and the people roster with LinkedIn URLs. The article writer may only use links listed here — anything else is stripped. See lib/podcast.ts PodcastConfig.';
