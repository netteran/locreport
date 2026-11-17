-- Private, per-Friday editable editions. Sent HTML remains in digest_sends.
create table if not exists public.weekly_newsletter_editions (
  edition_date date primary key check (extract(isodow from edition_date) = 5),
  subject text not null check (length(btrim(subject)) between 1 and 200 and subject !~ E'[\r\n]'),
  body_markdown text not null check (length(btrim(body_markdown)) between 1 and 60000),
  article_ids uuid[] not null default '{}',
  updated_at timestamptz not null default now()
);
alter table public.weekly_newsletter_editions enable row level security;
revoke all on public.weekly_newsletter_editions from public, anon, authenticated;
grant select, insert, update, delete on public.weekly_newsletter_editions to service_role;
