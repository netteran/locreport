-- Storage bucket for article imagery.
--
-- Article images used to be pasted in as third-party URLs; the admin editors
-- now drag and drop files, which land in the public `images` bucket and are
-- referenced from articles.image_url / drafts.image_url by their public URL.
--
-- The bucket itself predates this migration — article images were uploaded to
-- it by hand from the Supabase dashboard, and live articles already reference
-- objects at its root. What this pins is the limits the upload path assumes,
-- so Supabase enforces them independently of the client. (The insert branch
-- only matters for a fresh project.)
--
-- Writes are authorised in /api/uploads/article-image: an admin session earns
-- a service-role signed upload URL, and the browser sends the bytes straight
-- to Supabase. Because the signed token carries the authorisation, no RLS
-- policy on storage.objects is needed. The bucket is public so a plain
-- <img src> resolves for readers without a token.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'images',
  'images',
  true,
  10485760, -- 10 MB, mirrors MAX_IMAGE_BYTES in lib/storage.ts
  array['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
