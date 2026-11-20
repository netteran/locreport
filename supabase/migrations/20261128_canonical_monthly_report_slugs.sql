-- Rename verified archive editions in place. IDs and publication dates stay
-- stable. The corresponding permanent redirects live in next.config.ts.
begin;

with editions(old_slug, slug, title) as (
  values
    ('monthly-report-november-2025', 'november-2025-localization-industry-report', 'November 2025 Localization Industry Report'),
    ('monthly-report-december-2025', 'december-2025-localization-industry-report', 'December 2025 Localization Industry Report'),
    ('monthly-report-january-2026', 'january-2026-localization-industry-report', 'January 2026 Localization Industry Report'),
    ('monthly-report-february-2026', 'february-2026-localization-industry-report', 'February 2026 Localization Industry Report'),
    ('monthly-report-march-2026', 'march-2026-localization-industry-report', 'March 2026 Localization Industry Report'),
    ('monthly-report-april-2026', 'april-2026-localization-industry-report', 'April 2026 Localization Industry Report'),
    ('monthly-report-may-2026', 'may-2026-localization-industry-report', 'May 2026 Localization Industry Report'),
    ('june-2026-industry-intelligence-report', 'june-2026-localization-industry-report', 'June 2026 Localization Industry Report'),
    ('july-2026-industry-intelligence-report-localization-and-translation', 'july-2026-localization-industry-report', 'July 2026 Localization Industry Report'),
    ('august-2026-industry-intelligence-report', 'august-2026-localization-industry-report', 'August 2026 Localization Industry Report'),
    ('monthly-report-september-2026', 'september-2026-localization-industry-report', 'September 2026 Localization Industry Report'),
    ('october-2026-industry-intelligence-report-localization-and-translation', 'october-2026-localization-industry-report', 'October 2026 Localization Industry Report')
)
update public.articles as article
set slug = edition.slug,
    title = edition.title
from editions as edition
where article.article_type = 'monthly-summary'
  and regexp_replace(article.slug, '^.*/', '') in (edition.old_slug, edition.slug)
  and (article.slug, article.title) is distinct from (edition.slug, edition.title);

commit;
