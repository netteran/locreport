-- Auto facts applies to RSS snippets as well as full-text evidence.
-- Keep source trust, event eligibility, attribution and conflict checks.
create or replace function record_candidate_event(p_candidate uuid, p_event uuid, p_identity text, p_descriptor jsonb, p_relation text, p_auto_eligible boolean,p_legacy_fact uuid default null)
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
    and not e.review_required;
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

-- Reconsider clean pending snippet facts on the next processing run. Do not
-- resurrect set-aside evidence, imported backlog or uncertain/conflicting events.
update source_candidates c
set processing_status='pending', next_retry_at=now()
from rss_sources s, industry_events e, facts f
where c.source_feed_id=s.id and s.active and s.auto_publish
  and c.quality='snippet' and c.allow_auto_publish and c.source_name is not null
  and c.status='available' and c.processing_status='ready' and c.review_reason is null
  and c.event_id=e.id and not e.review_required
  and f.event_id=e.id and f.status='pending' and f.review_reason is null;
