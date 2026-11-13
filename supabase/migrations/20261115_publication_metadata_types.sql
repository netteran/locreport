-- Repair article publication on installations whose classification columns use
-- JSONB rather than PostgreSQL text arrays. No table data or column types change.
-- Safe to reapply; replaces the function in place and preserves its owner/grants.
begin;

create or replace function publish_editorial_draft(p_draft uuid, p_article jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare d drafts; aid uuid; metadata articles;
begin
  select * into strict d from drafts where id=p_draft for update;
  if d.research_only then raise exception 'This source is research material; combine it from Source candidates'; end if;
  select id into aid from articles where draft_id=p_draft order by published_at limit 1;
  if aid is not null then return aid; end if;
  if d.composition_id is not null then
    perform 1 from compositions where id=d.composition_id and status='ready' for update;
    if not found then raise exception 'Composition is not ready for publication'; end if;
  end if;
  -- Populate against the deployed row type: older installations use text[]
  -- while some classification columns are jsonb. JSON arrays support both.
  metadata := jsonb_populate_record(null::articles, jsonb_build_object(
    'signal_ids', coalesce(nullif(p_article->'signal_ids', 'null'::jsonb), '[]'::jsonb),
    'business_implications', coalesce(nullif(p_article->'business_implications', 'null'::jsonb), '[]'::jsonb),
    'affected_segments', coalesce(nullif(p_article->'affected_segments', 'null'::jsonb), '[]'::jsonb)
  ));
  insert into articles(title,slug,content,excerpt,source_url,publisher,image_url,image_alt,draft_id,article_type,author,
    impact_score,time_horizon,signal_ids,business_implications,affected_segments,composition_id)
  values(p_article->>'title',p_article->>'slug',p_article->>'content',p_article->>'excerpt',p_article->>'source_url',
    p_article->>'publisher',p_article->>'image_url',p_article->>'image_alt',d.id,'industry',p_article->>'author',
    (p_article->>'impact_score')::integer,p_article->>'time_horizon',
    metadata.signal_ids,metadata.business_implications,metadata.affected_segments,d.composition_id)
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

revoke all on function publish_editorial_draft(uuid,jsonb) from public,anon,authenticated;
grant execute on function publish_editorial_draft(uuid,jsonb) to service_role;

commit;
