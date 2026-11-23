create or replace function public.increment_article_view(article_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update frfc_articles
  set view_count = view_count + 1
  where id = article_id and status = 'published';
end;
$$;

grant execute on function public.increment_article_view(uuid) to anon, authenticated;