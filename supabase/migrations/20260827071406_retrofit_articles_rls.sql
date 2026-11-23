
drop policy "admins can insert articles" on public.frfc_articles;
create policy "admins can insert articles" on public.frfc_articles
  for insert to authenticated with check (frfc_has_permission(auth.uid(), 'articles.create'));

drop policy "admins can update articles" on public.frfc_articles;
create policy "admins can update articles" on public.frfc_articles
  for update to authenticated using (frfc_has_permission(auth.uid(), 'articles.edit')) with check (frfc_has_permission(auth.uid(), 'articles.edit'));

drop policy "admins can delete articles" on public.frfc_articles;
create policy "admins can delete articles" on public.frfc_articles
  for delete to authenticated using (frfc_has_permission(auth.uid(), 'articles.delete'));

-- Publish/unpublish is a status-only change requiring its own permission,
-- distinct from general editing — enforced via a SECURITY DEFINER RPC
-- since one blanket UPDATE policy can't tell "change status" apart from
-- "edit body" on the same table/row.
create or replace function public.frfc_set_article_status(p_article_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  if p_status not in ('draft', 'published') then
    raise exception 'Invalid status: %', p_status;
  end if;
  if not frfc_has_permission(auth.uid(), 'articles.publish') then
    raise exception 'Permission denied: articles.publish required';
  end if;
  update public.frfc_articles
  set status = p_status,
      published_at = case when p_status = 'published' then coalesce(published_at, now()) else published_at end
  where id = p_article_id;
end;
$$;

grant execute on function public.frfc_set_article_status(uuid, text) to authenticated;
