begin;

create type public.article_content_type as enum ('brief', 'analysis', 'report');
alter table public.articles add column content_type public.article_content_type;
alter table public.drafts add column content_type public.article_content_type;

-- Be conservative with the historical archive. A brief must have a single
-- known source, brief-length copy and existing takeaways. Ambiguous entries
-- remain analysis. The article text and all stored slugs stay intact.
update public.articles
set content_type = case
  when article_type = 'monthly-summary' then 'report'::public.article_content_type
  when composition_id is null
    and source_url ~* '^https?://[^/[:space:]]+'
    and btrim(regexp_replace(coalesce(content, ''), '[[:space:]]+', ' ', 'g')) <> ''
    and cardinality(regexp_split_to_array(
      btrim(regexp_replace(coalesce(content, ''), '[[:space:]]+', ' ', 'g')), ' '
    )) between 200 and 450
    and case
      when jsonb_typeof(to_jsonb(business_implications)) = 'array'
      then jsonb_array_length(to_jsonb(business_implications)) >= 2
      else false
    end
  then 'brief'::public.article_content_type
  else 'analysis'::public.article_content_type
end;

update public.drafts
set content_type = 'report'
where article_type = 'monthly-summary';

-- Legacy writers may omit content_type during a rolling deploy. Reports keep
-- their existing article_type for the monthly evidence and publishing code.
create function public.sync_article_content_type()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.article_type = 'monthly-summary' then
    new.content_type := 'report';
  elsif new.content_type = 'report' then
    new.article_type := 'monthly-summary';
  elsif new.content_type is null then
    new.content_type := 'analysis';
  end if;
  return new;
end $$;

create trigger sync_article_content_type before insert or update of article_type, content_type
on public.articles for each row execute function public.sync_article_content_type();

alter table public.articles alter column content_type set not null;

-- Normalize the historical aliases used by the previous edge routing and
-- monthly report slug migration before selecting the canonical feed rows.
create function public.article_route_slug(raw_slug text, format public.article_content_type)
returns text language sql immutable strict set search_path = public as $$
  select coalesce(aliases.canonical, normalized.bare)
  from (select lower(regexp_replace(rtrim(raw_slug, '/'), '^.*/', '')) as bare) normalized
  left join (values
    ('enterprise-cms-localization-governance-workflow-and-risk-control-at-scale-mq554wuk', 'enterprise-cms-localization-governance-workflow-and-risk-control-at-scale', false),
    ('should-you-build-or-buy-your-localization-infrastructure-mq552v16', 'should-you-build-or-buy-your-localization-infrastructure', false),
    ('what-happens-when-ai-translates-for-an-audience-not-just-a-language-mq5502ba', 'what-happens-when-ai-translates-for-an-audience-not-just-a-language', false),
    ('forcing-the-fit-mqm-in-the-age-of-automated-evaluation-mq1exsjs', 'forcing-the-fit-mqm-in-the-age-of-automated-evaluation', false),
    ('designing-ai-enabled-localization-workflows-for-enterprise-operations-mq1afbro', 'designing-ai-enabled-localization-workflows-for-enterprise-operations', false),
    ('every-market-is-a-new-market-mq1abdr4', 'every-market-is-a-new-market', false),
    ('international-search-summit-new-york-mq12u088', 'international-search-summit-new-york', false),
    ('humanx-2026-what-vistatec-took-away-from-ais-most-talked-ab', 'humanx-2026--what-vistatec-took-away-from-ais-most-talked-ab', false),
    ('smartling-achieves-iso-27001-certification-strengthening-sec', 'smartling-achieves-iso-27001-certification-strengthening-sec-1', false),
    ('measuring-translation-quality-when-you-dont-speak-the-langua', 'measuring-translation-quality-when-you-dont-speak-the-langua-1', false),
    ('industry-lingopal-wins-2026-nab-show-product-of-the-year-awa', 'lingopal-wins-2026-nab-show-product-of-the-year-award', false),
    ('the-future-of-language-intelligence-a-conversation-with-xtm', 'the-future-of-language-intelligence-a-conversation-with-xtm-1', false),
    ('the-2026-slator-', 'the-2026-slator-index', false),
    ('broadcasting-ai-dubbing-for-broadcasters-what-teams-need-now', 'ai-dubbing-for-broadcasters-what-teams-need-now', false),
    ('mastering-social-media-moves', 'mastering-social-media-moves-1', false),
    ('how-to-turn-technical-documentation-into-multilingual-videos', 'how-to-turn-technical-documentation-into-multilingual-videos-1', false),
    ('finalmente-facebook-makes-it-easier-to-post-status-updates-i', 'finalmente-facebook-makes-it-easier-to-post-status-updates-i-1', false),
    ('may-2026-localization-and-translation-industry-report-mq014946', 'may-2026-localization-industry-report', false),
    ('monthly-report-november-2025', 'november-2025-localization-industry-report', true),
    ('monthly-report-december-2025', 'december-2025-localization-industry-report', true),
    ('monthly-report-january-2026', 'january-2026-localization-industry-report', true),
    ('monthly-report-february-2026', 'february-2026-localization-industry-report', true),
    ('monthly-report-march-2026', 'march-2026-localization-industry-report', true),
    ('monthly-report-april-2026', 'april-2026-localization-industry-report', true),
    ('monthly-report-may-2026', 'may-2026-localization-industry-report', true),
    ('june-2026-industry-intelligence-report', 'june-2026-localization-industry-report', true),
    ('july-2026-industry-intelligence-report-localization-and-translation', 'july-2026-localization-industry-report', true),
    ('august-2026-industry-intelligence-report', 'august-2026-localization-industry-report', true),
    ('monthly-report-september-2026', 'september-2026-localization-industry-report', true),
    ('october-2026-industry-intelligence-report-localization-and-translation', 'october-2026-localization-industry-report', true)
  ) as aliases(legacy, canonical, monthly_only)
    on aliases.legacy = normalized.bare and (not aliases.monthly_only or format = 'report')
$$;

alter table public.articles add column content_slug text
  generated always as (public.article_route_slug(slug, content_type)) stored;

-- Historically a dated path or alias with a bare canonical equivalent went
-- to that same story. Let the canonical record's classification win too.
update public.articles as historical
set content_type = canonical.content_type
from public.articles as canonical
where historical.content_slug = canonical.slug
  and lower(historical.slug) <> historical.content_slug
  and historical.content_type <> canonical.content_type
  and (historical.article_type is distinct from 'monthly-summary' or canonical.content_type = 'report');

create index articles_public_content_slug_idx
on public.articles (content_slug, content_type, (lower(slug) = content_slug) desc, published_at, id);

-- Keep only the canonical row per public URL. A bare canonical slug takes
-- precedence, then the oldest dated copy. Security invoker preserves RLS.
create view public.public_article_index with (security_invoker = true) as
select distinct on (content_slug, content_type)
  id, slug, content_slug, content_type, article_type, title, excerpt, author,
  image_url, published_at, updated_at, monthly_period, report_start_date, report_end_date
from public.articles
where published_at is not null and content_slug <> ''
order by content_slug, content_type, (lower(slug) = content_slug) desc, published_at, id;

grant select on public.public_article_index to anon, authenticated, service_role;

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
    impact_score,time_horizon,signal_ids,business_implications,affected_segments,composition_id,monthly_period,report_start_date,report_end_date,content_type)
  values(p_article->>'title',p_article->>'slug',p_article->>'content',p_article->>'excerpt',p_article->>'source_url',
    p_article->>'publisher',p_article->>'image_url',p_article->>'image_alt',d.id,case when d.article_type='monthly-summary' then 'monthly-summary' else 'industry' end,p_article->>'author',
    (p_article->>'impact_score')::integer,p_article->>'time_horizon',
    metadata.signal_ids,metadata.business_implications,metadata.affected_segments,d.composition_id,d.monthly_period,d.report_start_date,d.report_end_date,
    case when d.article_type='monthly-summary' then 'report'::public.article_content_type
      else coalesce((p_article->>'content_type')::public.article_content_type,d.content_type,'analysis') end)
  returning id into aid;
  update drafts set status='approved',
    content_type=(select content_type from articles where id=aid) where id=d.id;
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
