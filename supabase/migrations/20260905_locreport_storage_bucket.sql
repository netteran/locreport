-- Storage bucket for admin-uploaded article imagery.
--
-- Article images used to be pasted in as third-party URLs; the admin editors
-- now drag and drop files, which land here and are referenced from
-- articles.image_url / drafts.image_url by their public URL.
--
-- Writes are authorised in /api/uploads/article-image: an admin session earns
-- a service-role signed upload URL, and the browser sends the bytes straight
-- to Supabase. Because the signed token carries the authorisation, no RLS
-- policy on storage.objects is needed. The bucket is public so a plain
-- <img src> resolves for readers without a token.
--
-- /api/uploads/article-image creates this bucket on first upload if it is
-- missing; this migration is the declarative version of the same thing, and
-- re-asserts the limits if they were changed by hand.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'locreport',
  'locreport',
  true,
  10485760, -- 10 MB, mirrors MAX_IMAGE_BYTES in lib/storage.ts
  array['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
