-- Weekly-only digest + explicit "what do I receive" preferences.
--
-- 1. The daily digest is gone. Nobody is on it any more, so every remaining
--    subscriber is weekly by definition and the column carries no information.
-- 2. Subscribers now choose their digest *contents* rather than just filtering
--    it: a general weekly roundup, dedicated signal briefings, or both.

alter table subscribers
  add column if not exists include_summary boolean not null default true;

comment on column subscribers.include_summary is
  'Include the general weekly roundup (everything published in the period, impact-ranked) on top of any selected signal briefings. False = signal briefings only, which requires a non-empty signal_prefs.';

comment on column subscribers.signal_prefs is
  'Signal ids from lib/signals.ts to receive dedicated briefing sections for. Empty = no signal briefings (the digest is then the general roundup alone, so include_summary must be true).';

-- Subscribers who had already narrowed themselves to specific signals were
-- receiving *only* those signals' articles. Keep that: default the new flag to
-- true for everyone, then turn it off for anyone whose signal picks were
-- already acting as a filter, so nobody's digest silently widens.
update subscribers
   set include_summary = false
 where coalesce(array_length(signal_prefs, 1), 0) > 0;

-- A subscriber with neither a roundup nor a signal pick would match nothing.
alter table subscribers
  drop constraint if exists subscribers_digest_content_check;
alter table subscribers
  add constraint subscribers_digest_content_check
  check (include_summary or coalesce(array_length(signal_prefs, 1), 0) > 0);

-- Weekly is the only cadence now (no rows were on 'daily' when this ran).
update subscribers set frequency = 'weekly' where frequency <> 'weekly';
alter table subscribers drop column if exists frequency;
