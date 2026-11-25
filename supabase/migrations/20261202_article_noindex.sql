-- Per-article search-engine exclusion for archive pruning.
-- A noindex article stays published and readable (and keeps its Fact Flow fact),
-- but its page sends <meta name="robots" content="noindex, follow"> and the
-- sitemap leaves it out. Toggle it from /admin/articles/[id].
alter table public.articles add column if not exists noindex boolean not null default false;

create index if not exists articles_noindex_idx on public.articles (id) where noindex;
