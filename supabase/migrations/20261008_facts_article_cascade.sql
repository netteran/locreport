-- A Fact Flow fact belongs to its article: deleting the article deletes the fact.
-- The FK was ON DELETE SET NULL, which left an orphan row behind on every
-- article delete. lib/deleteArticles.ts deletes the facts explicitly as well;
-- this covers deletes made outside the app (Supabase dashboard, SQL).

ALTER TABLE facts DROP CONSTRAINT IF EXISTS facts_article_id_fkey;
ALTER TABLE facts
  ADD CONSTRAINT facts_article_id_fkey
  FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE;
