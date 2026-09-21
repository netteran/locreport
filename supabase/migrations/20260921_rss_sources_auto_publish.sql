-- Lets a trusted rss_sources row skip /admin/drafts entirely: /api/ingest
-- calls the same approveDraft() path a human approval uses (lib/publish.ts)
-- immediately after creating the draft, instead of leaving it pending.
-- Defaults to false so every existing and future source stays on manual
-- review until deliberately promoted based on its approve/reject history.
alter table rss_sources
  add column if not exists auto_publish boolean not null default false;

comment on column rss_sources.auto_publish is
  'When true, /api/ingest auto-approves every draft from this source via lib/publish.ts approveDraft() instead of leaving it pending for /admin/drafts. Off by default — set per source based on its historical draft approve/reject rate.';
