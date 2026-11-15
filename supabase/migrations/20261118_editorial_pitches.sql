-- Editorial assessments belong to suggestions; they never authorize publication.
alter table story_groups add column if not exists pitch jsonb;
