-- Preserve inclusive editorial dates and allow separate ranges within one month.
begin;
alter table drafts add column if not exists report_start_date date;
alter table drafts add column if not exists report_end_date date;
alter table articles add column if not exists report_start_date date;
alter table articles add column if not exists report_end_date date;

-- Older clients still submit monthly_period alone during deployment.
create or replace function default_monthly_report_dates()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.article_type='monthly-summary' and new.monthly_period is not null
    and new.report_start_date is null and new.report_end_date is null then
    new.report_start_date := (new.monthly_period || '-01')::date;
    new.report_end_date := (new.report_start_date + interval '1 month - 1 day')::date;
  end if;
  return new;
end $$;
drop trigger if exists default_monthly_report_dates on drafts;
create trigger default_monthly_report_dates before insert or update on drafts
  for each row execute function default_monthly_report_dates();

update drafts set report_start_date=(monthly_period || '-01')::date,
  report_end_date=((monthly_period || '-01')::date + interval '1 month - 1 day')::date
where article_type='monthly-summary' and monthly_period is not null and report_start_date is null;
update articles set report_start_date=(monthly_period || '-01')::date,
  report_end_date=((monthly_period || '-01')::date + interval '1 month - 1 day')::date
where article_type='monthly-summary' and monthly_period is not null and report_start_date is null;

alter table drafts drop constraint if exists drafts_report_date_range;
alter table drafts add constraint drafts_report_date_range check (
  (report_start_date is null and report_end_date is null) or
  (report_start_date is not null and report_end_date is not null and report_start_date <= report_end_date));
alter table articles drop constraint if exists articles_report_date_range;
alter table articles add constraint articles_report_date_range check (
  (report_start_date is null and report_end_date is null) or
  (report_start_date is not null and report_end_date is not null and report_start_date <= report_end_date));
drop index if exists monthly_report_pending_draft;
create unique index if not exists monthly_report_range_pending_draft on drafts(report_start_date,report_end_date)
  where article_type='monthly-summary' and status in ('pending','rerun','rerunning');

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
    impact_score,time_horizon,signal_ids,business_implications,affected_segments,composition_id,monthly_period,report_start_date,report_end_date)
  values(p_article->>'title',p_article->>'slug',p_article->>'content',p_article->>'excerpt',p_article->>'source_url',
    p_article->>'publisher',p_article->>'image_url',p_article->>'image_alt',d.id,case when d.article_type='monthly-summary' then 'monthly-summary' else 'industry' end,p_article->>'author',
    (p_article->>'impact_score')::integer,p_article->>'time_horizon',
    metadata.signal_ids,metadata.business_implications,metadata.affected_segments,d.composition_id,d.monthly_period,d.report_start_date,d.report_end_date)
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
