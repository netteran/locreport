-- Enable one-source compositions after the research-publications migration.
-- Replace functions in place to preserve existing drafts, reservations and grants.
begin;

create or replace function reserve_composition(p_id uuid, p_candidates uuid[], p_user uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare c source_candidates; n integer := 0;
begin
  if coalesce(cardinality(p_candidates),0) < 1 or cardinality(p_candidates) > 8 then raise exception 'Select 1–8 source candidates'; end if;
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

revoke all on function reserve_composition(uuid,uuid[],uuid) from public,anon,authenticated;
revoke all on function replace_composition_sources(uuid,uuid[]) from public,anon,authenticated;
grant execute on function reserve_composition(uuid,uuid[],uuid) to service_role;
grant execute on function replace_composition_sources(uuid,uuid[]) to service_role;

commit;
