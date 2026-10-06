-- The outlet that published a draft's story, when it isn't the feed itself.
-- Google News sources are named after our own search queries ("Google News –
-- Platforms"); the real publisher comes from each item's <source> tag and is
-- pinned here at ingest so Stage 2, re-runs and the Fact Flow fact credit it.
-- Null = use rss_sources.name (ordinary feeds) or unknown (aggregators).
alter table drafts add column if not exists source_name text;
