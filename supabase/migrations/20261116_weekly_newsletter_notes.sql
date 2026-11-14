-- One optional editor's paragraph per Friday edition. Only server-side admin
-- and sending routes use this table; unfinished newsletter copy stays private.
begin;

create table public.weekly_newsletter_notes (
  edition_date date primary key check (extract(isodow from edition_date) = 5),
  paragraph text not null default '' check (char_length(paragraph) <= 2000),
  updated_at timestamptz not null default now()
);
alter table public.weekly_newsletter_notes enable row level security;
revoke all on public.weekly_newsletter_notes from public, anon, authenticated;
grant select, insert, update on public.weekly_newsletter_notes to service_role;

commit;
