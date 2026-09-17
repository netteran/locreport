-- Snapshot the exact subject + HTML each subscriber received, so a past send
-- can be viewed later exactly as sent instead of reconstructed from
-- article_ids against a subscriber's (possibly since-changed) preferences.

alter table digest_sends
  add column if not exists subject text,
  add column if not exists html text;

comment on column digest_sends.subject is
  'Email subject as actually sent. Null on rows written before this column existed.';
comment on column digest_sends.html is
  'Full rendered email HTML as actually sent. Null on rows written before this column existed.';
