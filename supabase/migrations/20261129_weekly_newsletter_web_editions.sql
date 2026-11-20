-- Immutable, recipient-free HTML for newsletter links. The public route
-- exposes individual editions by ID. Subscriber delivery records stay private.
create table if not exists public.weekly_newsletter_web_editions (
  id text primary key check (id ~ '^[a-f0-9]{64}$'),
  edition_date date not null check (extract(isodow from edition_date) = 5),
  html text not null check (length(btrim(html)) > 0),
  created_at timestamptz not null default now()
);

alter table public.weekly_newsletter_web_editions enable row level security;
revoke all on public.weekly_newsletter_web_editions from public, anon, authenticated;
grant select, insert on public.weekly_newsletter_web_editions to service_role;
