-- Apply before deploying the application. No old backlog is auto-published.
begin;
create extension if not exists vector;

alter table rss_sources add column if not exists auto_collect boolean not null default false;
update rss_sources set auto_collect = true where kind = 'podcast' and auto_publish;
comment on column rss_sources.auto_publish is 'Trusted source: automatically publish eligible event-deduplicated Fact Flow items only. Never generate or publish full articles.';

create table industry_events (
  id uuid primary key default gen_random_uuid(),
  identity_key text not null unique,
  subject text not null, action text not null, object text not null, stage text not null,
  event_date date, headline text not null, entities text[] not null default '{}',
  review_required boolean not null default false,
  created_at timestamptz not null default now()
);
create table source_candidates (
  id uuid primary key default gen_random_uuid(),
  title text not null, source_url text not null unique, source_name text,
  source_feed_id uuid references rss_sources(id) on delete set null,
  source_published_at timestamptz, extracted_facts text not null,
  quality text not null default 'full' check (quality in ('full','snippet','notes')),
  allow_auto_publish boolean not null default true,
  topics text[] not null default '{}', entities text[] not null default '{}', embedding vector(1536),
  status text not null default 'available' check (status in ('available','reserved','used','dismissed')),
  processing_status text not null default 'pending' check (processing_status in ('pending','ready','error')),
  next_retry_at timestamptz not null default now(),
  review_reason text, event_id uuid references industry_events(id) on delete set null,
  suggested_event_id uuid references industry_events(id) on delete set null,
  suggested_fact_id uuid references facts(id) on delete set null,
  reserved_by uuid, legacy_draft_id uuid references drafts(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index source_candidates_embedding_idx on source_candidates using hnsw (embedding vector_cosine_ops);
create index source_candidates_processing_idx on source_candidates (processing_status, created_at);
create table event_sources (
  event_id uuid not null references industry_events(id) on delete cascade,
  candidate_id uuid not null references source_candidates(id) on delete cascade,
  confirmed boolean not null default true,
  primary key(event_id, candidate_id)
);
create table story_groups (
  id uuid primary key default gen_random_uuid(), fingerprint text not null unique,
  title text not null, question text not null, rationale text not null,
  candidate_ids uuid[] not null, dismissed boolean not null default false,
  created_at timestamptz not null default now()
);
create table compositions (
  id uuid primary key default gen_random_uuid(),
  title text not null default '', angle text not null default '', personal_experience text not null default '',
  target_words integer not null default 1400 check (target_words between 600 and 2400),
  status text not null default 'editing' check (status in ('editing','generating','ready','published','abandoned','failed')),
  draft_id uuid references drafts(id) on delete set null, requested_by uuid,
  generation_started_at timestamptz, generation_request_id uuid, last_error text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table source_candidates add constraint source_candidates_reservation_fk foreign key (reserved_by) references compositions(id) on delete set null;
create table composition_sources (
  composition_id uuid not null references compositions(id) on delete cascade,
  candidate_id uuid not null references source_candidates(id),
  snapshot jsonb not null, covered boolean not null default false, position integer not null default 0,
  primary key(composition_id, candidate_id)
);
alter table drafts add column if not exists composition_id uuid references compositions(id) on delete set null;
create unique index drafts_composition_unique on drafts(composition_id) where composition_id is not null;
alter table drafts add column if not exists research_only boolean not null default false;
alter table articles add column if not exists composition_id uuid references compositions(id) on delete set null;
create unique index articles_composition_unique on articles(composition_id) where composition_id is not null;

alter table facts add column if not exists status text not null default 'pending' check (status in ('pending','published','rejected','withdrawn'));
alter table facts add column if not exists published_at timestamptz;
alter table facts add column if not exists event_id uuid references industry_events(id) on delete set null;
alter table facts add column if not exists review_reason text;
create unique index facts_event_unique on facts(event_id) where event_id is not null;
create index facts_publication_idx on facts(status, published_at desc);
update facts set status = 'published', published_at = created_at where article_id is not null;
alter table facts drop constraint if exists facts_article_id_fkey;
alter table facts add constraint facts_article_id_fkey foreign key (article_id) references articles(id) on delete set null;
create table fact_article_links (
  fact_id uuid not null references facts(id) on delete cascade,
  article_id uuid not null references articles(id) on delete cascade,
  primary key(fact_id, article_id)
);
insert into fact_article_links select id, article_id from facts where article_id is not null on conflict do nothing;

create function maintain_fact_publication_links() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.article_id is not null then
    insert into fact_article_links values(new.id,new.article_id) on conflict do nothing;
  end if;
  if new.status='published' and new.event_id is not null then
    insert into fact_article_links(fact_id,article_id)
      select new.id,a.id from compositions comp join articles a on a.composition_id=comp.id
      join composition_sources cs on cs.composition_id=comp.id and cs.covered
      join source_candidates c on c.id=cs.candidate_id
      where comp.status='published' and c.event_id=new.event_id on conflict do nothing;
  end if;
  return new;
end $$;
create trigger facts_publication_links after insert or update of article_id,status on facts
  for each row execute function maintain_fact_publication_links();

-- Preserve unpublished source evidence, but do not reinterpret generated prose as evidence.
insert into source_candidates(title, source_url, source_name, source_feed_id, source_published_at, extracted_facts, quality, legacy_draft_id, created_at, allow_auto_publish)
select distinct on (d.source_url) d.title, d.source_url, s.name, d.source_feed_id, d.source_published_at,
  d.extracted_facts, case when s.kind = 'podcast' then 'notes' else 'full' end, d.id, d.created_at, false
from drafts d left join rss_sources s on s.id = d.source_feed_id
where d.status in ('pending','rerun') and d.source_url ~ '^https?://' and length(trim(d.extracted_facts)) > 0
order by d.source_url, d.created_at desc;
update drafts set research_only = true where id in (select legacy_draft_id from source_candidates);
update facts set status='rejected',review_reason='Source moved to research; review its event-based fact instead'
  where status='pending' and draft_id in(select legacy_draft_id from source_candidates);

-- A short, expiring global processing lease serializes semantic event matching across runs.
create table research_locks (name text primary key, owner uuid not null, expires_at timestamptz not null);
create function claim_research_lock(p_owner uuid) returns boolean language plpgsql security definer set search_path = public as $$
begin
  insert into research_locks values ('events', p_owner, now() + interval '5 minutes')
  on conflict (name) do update set owner = excluded.owner, expires_at = excluded.expires_at
    where research_locks.expires_at < now() or research_locks.owner = excluded.owner;
  return found;
end $$;
create function release_research_lock(p_owner uuid) returns void language sql security definer set search_path = public as $$
  delete from research_locks where name = 'events' and owner = p_owner;
$$;

-- A source can provide evidence without ever publishing a second fact.
create function record_candidate_event(p_candidate uuid, p_event uuid, p_identity text, p_descriptor jsonb, p_relation text, p_auto_eligible boolean,p_legacy_fact uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare c source_candidates; e industry_events; eid uuid; trusted boolean; auto_ok boolean; legacy facts;
begin
  perform pg_advisory_xact_lock(hashtext('locreport-event-publication'));
  select * into strict c from source_candidates where id = p_candidate for update;
  if p_relation not in ('new','same','conflict','uncertain') then raise exception 'Invalid event relationship'; end if;
  if p_relation = 'uncertain' then
    update source_candidates set review_reason = 'Uncertain event match: review before publishing', suggested_event_id = p_event,
      suggested_fact_id=p_legacy_fact,
      processing_status = 'ready' where id = c.id;
    return null;
  end if;
  eid := p_event;
  if eid is null then
    insert into industry_events(identity_key, subject, action, object, stage, event_date, headline, entities)
    values (p_identity, p_descriptor->>'subject', p_descriptor->>'action', p_descriptor->>'object', p_descriptor->>'stage',
      nullif(p_descriptor->>'event_date','')::date, p_descriptor->>'headline',
      array(select jsonb_array_elements_text(coalesce(p_descriptor->'entities','[]'))))
    on conflict(identity_key) do nothing returning id into eid;
    if eid is null then select id into eid from industry_events where identity_key = p_identity; end if;
  end if;
  select * into strict e from industry_events where id = eid for update;
  -- Previously published legacy facts have no event_id. Adopt one rather than republishing it.
  if p_legacy_fact is not null then
    select * into strict legacy from facts where id=p_legacy_fact and status='published' for update;
    if legacy.event_id is not null and legacy.event_id<>eid then raise exception 'Legacy fact already belongs to another event'; end if;
    if exists(select 1 from facts where event_id=eid and id<>legacy.id) then raise exception 'Event already has a fact; merge the events after review'; end if;
    update facts set event_id=eid where id=legacy.id;
    update industry_events set headline=legacy.content where id=eid;
    e.headline:=legacy.content;
  end if;
  insert into event_sources values (eid, c.id, p_relation <> 'conflict')
    on conflict(event_id, candidate_id) do update set confirmed = excluded.confirmed;
  update source_candidates set event_id = eid, processing_status = 'ready',
    suggested_event_id = null, suggested_fact_id=null, review_reason = case when p_relation = 'conflict' then 'Conflicting source: review the published claim' else null end
    where id = c.id;
  if p_relation = 'conflict' then
    update industry_events set review_required = true where id = eid;
    update facts set review_reason = 'Conflicting evidence requires review' where event_id = eid;
    return eid;
  end if;
  if p_relation='same' and e.review_required and not exists(select 1 from event_sources where event_id=eid and not confirmed) then
    update industry_events set review_required=false where id=eid;
    update facts set review_reason=null where event_id=eid;
    e.review_required:=false;
  end if;
  select auto_publish into trusted from rss_sources where id = c.source_feed_id and active;
  auto_ok := coalesce(trusted,false) and p_auto_eligible and c.allow_auto_publish and c.source_name is not null
    and c.quality <> 'snippet' and not e.review_required;
  insert into facts(content, category, source_url, source_name, event_id, status, published_at)
  values (e.headline, 'news', c.source_url, c.source_name, eid,
    case when auto_ok then 'published' else 'pending' end, case when auto_ok then now() else null end)
  on conflict(event_id) where event_id is not null do nothing;
  -- Trusted corroboration can release a clean pending fact; it never rewrites a public sentence.
  if auto_ok then
    update facts set status = 'published', published_at = now(), source_url = c.source_url, source_name = c.source_name,
      content=p_descriptor->>'headline'
      where event_id = eid and status = 'pending' and review_reason is null;
    if found then update industry_events set headline=p_descriptor->>'headline' where id=eid; end if;
  end if;
  return eid;
end $$;

create function match_candidate_events(p_embedding vector(1536))
returns table(id uuid, subject text, action text, object text, stage text, event_date date, headline text, evidence text, similarity double precision)
language sql stable security definer set search_path = public as $$
  select matched.id,matched.subject,matched.action,matched.object,matched.stage,matched.event_date,matched.headline,
    matched.extracted_facts,matched.similarity from (
      select distinct on (e.id) e.id,e.subject,e.action,e.object,e.stage,e.event_date,e.headline,c.extracted_facts,
        (1-(c.embedding <=> p_embedding))::double precision as similarity
      from industry_events e join event_sources es on es.event_id=e.id and es.confirmed
      join source_candidates c on c.id=es.candidate_id where c.embedding is not null
      order by e.id,c.embedding <=> p_embedding
    ) matched order by similarity desc limit 12;
$$;

create function candidate_group_edges() returns table(source_id uuid,related_id uuid,similarity double precision)
language sql stable security definer set search_path=public as $$
  with pool as (select id,embedding from source_candidates where status='available' and processing_status='ready'
    and created_at>=now()-interval '30 days' and embedding is not null order by created_at desc limit 60)
  select seed.id,neighbor.id,(1-(seed.embedding <=> neighbor.embedding))::double precision
  from pool seed cross join lateral(select other.id,other.embedding from pool other where other.id<>seed.id
    and (seed.embedding <=> other.embedding)<0.35 order by seed.embedding <=> other.embedding limit 5) neighbor;
$$;

create function reserve_composition(p_id uuid, p_candidates uuid[], p_user uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare c source_candidates; n integer := 0;
begin
  if cardinality(p_candidates) < 2 or cardinality(p_candidates) > 8 then raise exception 'Select 2–8 source candidates'; end if;
  insert into compositions(id, requested_by) values(p_id,p_user) on conflict(id) do nothing;
  if exists(select 1 from composition_sources where composition_id = p_id) then return p_id; end if;
  for c in select * from source_candidates where id = any(p_candidates) order by id for update loop
    if c.status <> 'available' or length(trim(c.extracted_facts)) = 0 then raise exception 'Source is unavailable or has no evidence'; end if;
    insert into composition_sources(composition_id,candidate_id,snapshot,position)
      values(p_id,c.id,to_jsonb(c) - 'embedding',array_position(p_candidates,c.id));
    update source_candidates set status = 'reserved', reserved_by = p_id where id = c.id;
    n := n + 1;
  end loop;
  if n <> cardinality(p_candidates) then raise exception 'Some selected sources no longer exist'; end if;
  return p_id;
end $$;

create function replace_composition_sources(p_id uuid, p_candidates uuid[]) returns void
language plpgsql security definer set search_path=public as $$
declare c source_candidates; old_ids uuid[]; n integer:=0;
begin
  perform 1 from compositions where id=p_id and status in ('editing','ready','failed') for update;
  if not found then raise exception 'Composition cannot be edited'; end if;
  if cardinality(p_candidates)<2 or cardinality(p_candidates)>8 then raise exception 'Select 2–8 source candidates'; end if;
  select array_agg(candidate_id order by position,candidate_id) into old_ids from composition_sources where composition_id=p_id;
  if old_ids=p_candidates then return; end if;
  for c in select * from source_candidates where id=any(p_candidates) order by id for update loop
    if c.status<>'available' and c.reserved_by is distinct from p_id then raise exception 'Source is unavailable'; end if;
    if length(trim(c.extracted_facts))=0 then raise exception 'Source has no evidence'; end if;
    insert into composition_sources(composition_id,candidate_id,snapshot,position)
      values(p_id,c.id,to_jsonb(c)-'embedding',array_position(p_candidates,c.id))
      on conflict(composition_id,candidate_id) do update set position=excluded.position;
    update source_candidates set status='reserved',reserved_by=p_id where id=c.id;
    n:=n+1;
  end loop;
  if n<>cardinality(p_candidates) then raise exception 'Source not found or duplicated'; end if;
  update source_candidates set status='available',reserved_by=null where reserved_by=p_id and not(id=any(p_candidates));
  delete from composition_sources where composition_id=p_id and not(candidate_id=any(p_candidates));
  update compositions set status='editing' where id=p_id;
end $$;

create function abandon_composition(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  perform 1 from compositions where id = p_id for update;
  if exists(select 1 from compositions where id=p_id and status in ('generating','published')) then raise exception 'Cannot release an active generation or published composition'; end if;
  update compositions set status='abandoned' where id=p_id;
  update source_candidates set status='available', reserved_by=null where reserved_by=p_id;
end $$;

create function claim_composition_generation(p_id uuid,p_request uuid) returns boolean language plpgsql security definer set search_path = public as $$
begin
  update compositions set status='generating', generation_started_at=now(), generation_request_id=p_request, last_error=null
    where id=p_id and ((status in ('editing','ready','failed') and (generation_request_id is distinct from p_request or status='failed'))
      or (status='generating' and generation_started_at < now()-interval '10 minutes'));
  return found;
end $$;

create function finish_composition_generation(p_id uuid,p_request uuid, p_title text, p_content text, p_slug text, p_urls text[])
returns uuid language plpgsql security definer set search_path = public as $$
declare did uuid;
begin
  perform 1 from compositions where id=p_id and status='generating' and generation_request_id=p_request for update;
  if not found then raise exception 'Composition is not generating'; end if;
  insert into drafts(title,slug,content,status,composition_id,extracted_facts)
  values(p_title,p_slug,p_content,'pending',p_id,
    (select string_agg((snapshot->>'source_url') || E'\n' || (snapshot->>'extracted_facts'),E'\n\n') from composition_sources where composition_id=p_id))
  on conflict(composition_id) where composition_id is not null do update
    set title=excluded.title, content=excluded.content, status='pending', updated_at=now()
  returning id into did;
  update composition_sources set covered = (snapshot->>'source_url') = any(p_urls) where composition_id=p_id;
  update compositions set status='ready', draft_id=did, last_error=null where id=p_id;
  return did;
end $$;

-- One transaction creates the article, marks its draft approved and links existing wire facts.
create function publish_editorial_draft(p_draft uuid, p_article jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare d drafts; aid uuid;
begin
  select * into strict d from drafts where id=p_draft for update;
  if d.research_only then raise exception 'This source is research material; combine it from Source candidates'; end if;
  select id into aid from articles where draft_id=p_draft order by published_at limit 1;
  if aid is not null then return aid; end if;
  if d.composition_id is not null then
    perform 1 from compositions where id=d.composition_id and status='ready' for update;
    if not found then raise exception 'Composition is not ready for publication'; end if;
  end if;
  insert into articles(title,slug,content,excerpt,source_url,publisher,image_url,image_alt,draft_id,article_type,author,
    impact_score,time_horizon,signal_ids,business_implications,affected_segments,composition_id)
  values(p_article->>'title',p_article->>'slug',p_article->>'content',p_article->>'excerpt',p_article->>'source_url',
    p_article->>'publisher',p_article->>'image_url',p_article->>'image_alt',d.id,'industry',p_article->>'author',
    (p_article->>'impact_score')::integer,p_article->>'time_horizon',
    array(select jsonb_array_elements_text(coalesce(p_article->'signal_ids','[]'))),
    array(select jsonb_array_elements_text(coalesce(p_article->'business_implications','[]'))),
    array(select jsonb_array_elements_text(coalesce(p_article->'affected_segments','[]'))),d.composition_id)
  returning id into aid;
  update drafts set status='approved' where id=d.id;
  if d.composition_id is not null then
    update composition_sources set covered=(snapshot->>'source_url') in
      (select jsonb_array_elements_text(coalesce(p_article->'covered_urls','[]'))) where composition_id=d.composition_id;
    insert into fact_article_links(fact_id,article_id)
      select distinct f.id,aid from composition_sources cs join source_candidates c on c.id=cs.candidate_id
      join facts f on f.event_id=c.event_id
      where cs.composition_id=d.composition_id and cs.covered and f.status='published'
      on conflict do nothing;
    update facts set article_id=aid where id in(select fact_id from fact_article_links where article_id=aid) and article_id is null;
    update compositions set status='published' where id=d.composition_id;
    update source_candidates set status='used', reserved_by=null where reserved_by=d.composition_id;
  end if;
  return aid;
end $$;

create function merge_industry_events(p_from uuid,p_into uuid) returns void language plpgsql security definer set search_path=public as $$
begin
  if p_from=p_into then raise exception 'Choose two different events'; end if;
  perform pg_advisory_xact_lock(hashtext('locreport-event-publication'));
  perform 1 from industry_events where id=p_into;
  if not found then raise exception 'Target event not found'; end if;
  insert into event_sources select p_into,candidate_id,confirmed from event_sources where event_id=p_from on conflict do nothing;
  insert into fact_article_links select target.id,l.article_id from facts old join fact_article_links l on l.fact_id=old.id
    cross join facts target where old.event_id=p_from and target.event_id=p_into on conflict do nothing;
  update source_candidates set event_id=p_into where event_id=p_from;
  update source_candidates set suggested_event_id=p_into where suggested_event_id=p_from;
  -- Keep the old permalink withdrawn, instead of deleting an already shared entry.
  update facts set status='withdrawn', review_reason='Merged into another event', event_id=null where event_id=p_from;
  delete from industry_events where id=p_from;
end $$;

-- New research data is service-role only. Public views reveal published citations, never raw notes.
alter table industry_events enable row level security;
alter table source_candidates enable row level security;
alter table event_sources enable row level security;
alter table story_groups enable row level security;
alter table compositions enable row level security;
alter table composition_sources enable row level security;
alter table research_locks enable row level security;
alter table fact_article_links enable row level security;
create policy fact_article_links_public on fact_article_links for select using (exists(select 1 from facts where id=fact_id and status='published'));
drop policy if exists facts_public_read on facts;
create policy facts_public_read on facts for select using (status='published');
create view public_fact_sources as
  select distinct f.id as fact_id,c.source_url,c.source_name,c.title
  from facts f join event_sources es on es.event_id=f.event_id and es.confirmed
  join source_candidates c on c.id=es.candidate_id where f.status='published';
grant select on public_fact_sources to anon, authenticated;
grant select on fact_article_links to anon, authenticated;

-- SECURITY DEFINER functions are internal, never callable with an anon/user JWT.
do $$ declare fn record; begin
  for fn in select oid::regprocedure as signature from pg_proc where pronamespace='public'::regnamespace
    and proname in ('claim_research_lock','release_research_lock','record_candidate_event','match_candidate_events','candidate_group_edges',
      'reserve_composition','replace_composition_sources','abandon_composition','claim_composition_generation','finish_composition_generation','publish_editorial_draft','merge_industry_events')
  loop execute format('revoke all on function %s from public, anon, authenticated',fn.signature);
    execute format('grant execute on function %s to service_role',fn.signature);
  end loop;
end $$;
commit;
