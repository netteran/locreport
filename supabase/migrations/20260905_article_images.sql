-- Optional lead image for articles.
--
-- Everything is opt-in: when image_url is null the article page and the feeds
-- render exactly as before. Setting it adds a hero image at the top of the
-- article and a thumbnail in the listings. image_alt is the accessible
-- description (falls back to the article title when empty).
--
-- Images are referenced by URL only — no upload/storage bucket involved.
alter table articles
  add column if not exists image_url text,
  add column if not exists image_alt text;

-- Carried through the draft review queue so an image chosen before publishing
-- survives "Save draft" and lands on the article on approval.
alter table drafts
  add column if not exists image_url text,
  add column if not exists image_alt text;
