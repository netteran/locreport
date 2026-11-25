-- Editor-proposed topics that gather evidence from the candidate pool over time.
-- Apply after 20261114_single_source_articles.sql. Topics never generate or publish
-- articles: they only suggest sources until an editor starts a composition.
begin;

create table if not exists editorial_topics (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) between 1 and 250),
  brief text not null check (length(trim(brief)) between 1 and 4000),
  -- Optional: a source must mention at least one of these terms to be considered.
  required_terms text[] not null default '{}',
  status text not null default 'watching' check (status in ('watching','ready','paused','closed')),
  notify_email boolean not null default false,
  -- Bumped whenever the brief changes so unreviewed matches are judged again.
  brief_version integer not null default 1,
  ready_at timestamptz,
  notified_at timestamptz,
  last_matched_at timestamptz,
  composition_id uuid references compositions(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Model-written descriptions of the evidence a topic needs. Candidates are compared
-- against these rather than against the brief itself: an opinionated brief and a news
-- report embed far apart even when the report is exactly what the brief needs.
create table if not exists editorial_topic_probes (
  topic_id uuid not null references editorial_topics(id) on delete cascade,
  position integer not null,
  description text not null,
  embedding vector(1536) not null,
  primary key (topic_id, position)
);

create table if not exists topic_matches (
  topic_id uuid not null references editorial_topics(id) on delete cascade,
  candidate_id uuid not null references source_candidates(id) on delete cascade,
  similarity double precision not null,
  relevance smallint not null check (relevance between 0 and 3),
  role text not null check (role in ('supports','contradicts','data','context')),
  contribution text not null default '',
  judged_version integer not null,
  decision text not null default 'suggested' check (decision in ('suggested','accepted','rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (topic_id, candidate_id)
);
create index if not exists topic_matches_candidate_idx on topic_matches(candidate_id);

alter table editorial_topics enable row level security;
alter table editorial_topic_probes enable row level security;
alter table topic_matches enable row level security;

-- Shortlist candidates a topic has not judged yet. The pool is small enough for an exact
-- scan, which (unlike an HNSW top-k) cannot hide a new candidate behind already-judged ones.
-- Every evidence status except set-aside qualifies: used and reserved sources remain evidence.
create or replace function topic_shortlist(p_topic uuid, p_min_similarity double precision, p_limit integer)
returns table(candidate_id uuid, similarity double precision)
language sql stable security definer set search_path = public as $$
  select c.id, max(1 - (c.embedding <=> p.embedding))::double precision as similarity
  from editorial_topics t
  join editorial_topic_probes p on p.topic_id = t.id
  join source_candidates c on c.embedding is not null
  where t.id = p_topic
    and c.processing_status = 'ready' and c.status <> 'dismissed'
    and length(trim(c.extracted_facts)) > 0
    and not exists (select 1 from topic_matches m where m.topic_id = t.id and m.candidate_id = c.id)
    and (cardinality(t.required_terms) = 0 or exists (
      select 1 from unnest(t.required_terms) term
      where position(lower(term) in lower(c.title || ' ' || c.extracted_facts || ' ' || array_to_string(c.entities, ' '))) > 0
    ))
  group by c.id
  having max(1 - (c.embedding <=> p.embedding)) >= p_min_similarity
  order by similarity desc
  limit greatest(1, least(p_limit, 50));
$$;
revoke all on function topic_shortlist(uuid,double precision,integer) from public, anon, authenticated;
grant execute on function topic_shortlist(uuid,double precision,integer) to service_role;

-- Sources used in a published article stay usable as evidence for further articles.
-- Releasing a reservation restores 'used' rather than 'available' when the source
-- already backs a published composition, so that history is not lost.
create or replace function released_candidate_status(p_candidate uuid) returns text
language sql stable security definer set search_path = public as $$
  select case when exists (
    select 1 from composition_sources cs join compositions comp on comp.id = cs.composition_id
    where cs.candidate_id = p_candidate and comp.status = 'published'
  ) then 'used' else 'available' end;
$$;

create or replace function reserve_composition(p_id uuid, p_candidates uuid[], p_user uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare c source_candidates; n integer := 0;
begin
  if coalesce(cardinality(p_candidates),0) < 1 or cardinality(p_candidates) > 8 then raise exception 'Select 1–8 source candidates'; end if;
  insert into compositions(id, requested_by) values(p_id,p_user) on conflict(id) do nothing;
  if exists(select 1 from composition_sources where composition_id = p_id) then return p_id; end if;
  for c in select * from source_candidates where id = any(p_candidates) order by id for update loop
    if c.status not in ('available','used') or length(trim(c.extracted_facts)) = 0 then raise exception 'Source is unavailable or has no evidence'; end if;
    insert into composition_sources(composition_id,candidate_id,snapshot,position)
      values(p_id,c.id,to_jsonb(c) - 'embedding',array_position(p_candidates,c.id));
    update source_candidates set status = 'reserved', reserved_by = p_id where id = c.id;
    n := n + 1;
  end loop;
  if n <> cardinality(p_candidates) then raise exception 'Some selected sources no longer exist'; end if;
  return p_id;
end $$;

create or replace function replace_composition_sources(p_id uuid, p_candidates uuid[]) returns void
language plpgsql security definer set search_path=public as $$
declare c source_candidates; old_ids uuid[]; n integer:=0;
begin
  perform 1 from compositions where id=p_id and status in ('editing','ready','failed') for update;
  if not found then raise exception 'Composition cannot be edited'; end if;
  if coalesce(cardinality(p_candidates),0)<1 or cardinality(p_candidates)>8 then raise exception 'Select 1–8 source candidates'; end if;
  select array_agg(candidate_id order by position,candidate_id) into old_ids from composition_sources where composition_id=p_id;
  if old_ids=p_candidates then return; end if;
  for c in select * from source_candidates where id=any(p_candidates) order by id for update loop
    if c.status not in ('available','used') and c.reserved_by is distinct from p_id then raise exception 'Source is unavailable'; end if;
    if length(trim(c.extracted_facts))=0 then raise exception 'Source has no evidence'; end if;
    insert into composition_sources(composition_id,candidate_id,snapshot,position)
      values(p_id,c.id,to_jsonb(c)-'embedding',array_position(p_candidates,c.id))
      on conflict(composition_id,candidate_id) do update set position=excluded.position;
    update source_candidates set status='reserved',reserved_by=p_id where id=c.id;
    n:=n+1;
  end loop;
  if n<>cardinality(p_candidates) then raise exception 'Source not found or duplicated'; end if;
  delete from composition_sources where composition_id=p_id and not(candidate_id=any(p_candidates));
  update source_candidates set status=released_candidate_status(id),reserved_by=null where reserved_by=p_id and not(id=any(p_candidates));
  update compositions set status='editing' where id=p_id;
end $$;

create or replace function abandon_composition(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  perform 1 from compositions where id = p_id for update;
  if exists(select 1 from compositions where id=p_id and status in ('generating','published')) then raise exception 'Cannot release an active generation or published composition'; end if;
  update compositions set status='abandoned' where id=p_id;
  update source_candidates set status=released_candidate_status(id), reserved_by=null where reserved_by=p_id;
end $$;

revoke all on function released_candidate_status(uuid) from public,anon,authenticated;
revoke all on function reserve_composition(uuid,uuid[],uuid) from public,anon,authenticated;
revoke all on function replace_composition_sources(uuid,uuid[]) from public,anon,authenticated;
revoke all on function abandon_composition(uuid) from public,anon,authenticated;
grant execute on function released_candidate_status(uuid) to service_role;
grant execute on function reserve_composition(uuid,uuid[],uuid) to service_role;
grant execute on function replace_composition_sources(uuid,uuid[]) to service_role;
grant execute on function abandon_composition(uuid) to service_role;

commit;
