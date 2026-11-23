
drop policy "Admins insert streamers" on public.frfc_streamers;
create policy "Admins insert streamers" on public.frfc_streamers
  for insert to authenticated with check (frfc_has_permission(auth.uid(), 'creators.create'));

drop policy "Admins update streamers" on public.frfc_streamers;
create policy "Admins update streamers" on public.frfc_streamers
  for update to authenticated using (frfc_has_permission(auth.uid(), 'creators.edit')) with check (frfc_has_permission(auth.uid(), 'creators.edit'));

drop policy "Admins delete streamers" on public.frfc_streamers;
create policy "Admins delete streamers" on public.frfc_streamers
  for delete to authenticated using (frfc_has_permission(auth.uid(), 'creators.delete'));

drop policy "Admins update submissions" on public.frfc_submissions;
create policy "Admins update submissions" on public.frfc_submissions
  for update to authenticated using (frfc_has_permission(auth.uid(), 'submissions.review')) with check (frfc_has_permission(auth.uid(), 'submissions.review'));

drop policy "Admins delete submissions" on public.frfc_submissions;
create policy "Admins delete submissions" on public.frfc_submissions
  for delete to authenticated using (frfc_has_permission(auth.uid(), 'submissions.review'));
