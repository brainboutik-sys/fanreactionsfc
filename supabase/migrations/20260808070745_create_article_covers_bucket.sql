insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('article-covers', 'article-covers', true, 4194304, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

create policy "article_covers_public_read"
  on storage.objects for select
  using (bucket_id = 'article-covers');

-- Unlike avatars (scoped to the uploader's own folder), cover images are
-- site content any admin should be able to manage — scoped to admin role,
-- not to a per-user folder.
create policy "article_covers_admin_write"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'article-covers'
    and exists (select 1 from public.frfc_admin_roles where user_id = auth.uid())
  );

create policy "article_covers_admin_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'article-covers'
    and exists (select 1 from public.frfc_admin_roles where user_id = auth.uid())
  )
  with check (
    bucket_id = 'article-covers'
    and exists (select 1 from public.frfc_admin_roles where user_id = auth.uid())
  );

create policy "article_covers_admin_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'article-covers'
    and exists (select 1 from public.frfc_admin_roles where user_id = auth.uid())
  );