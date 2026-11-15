-- Keep older waiting evidence eligible for the same bounded suggestion pool.
create or replace function candidate_group_edges()
returns table(source_id uuid,related_id uuid,similarity double precision)
language sql stable security definer set search_path=public as $$
  with pool as (
    select id,embedding from source_candidates
    where status='available' and processing_status='ready' and embedding is not null
    order by created_at desc limit 60
  )
  select seed.id,neighbor.id,(1-(seed.embedding <=> neighbor.embedding))::double precision
  from pool seed cross join lateral (
    select other.id,other.embedding from pool other
    where other.id<>seed.id and (seed.embedding <=> other.embedding)<0.35
    order by seed.embedding <=> other.embedding limit 5
  ) neighbor;
$$;
