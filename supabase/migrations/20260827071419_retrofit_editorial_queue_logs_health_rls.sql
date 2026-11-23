
drop policy "admins can do everything with story candidates" on public.frfc_story_candidates;
create policy "admins can read story candidates" on public.frfc_story_candidates
  for select to authenticated using (frfc_is_admin());
create policy "editorial_queue.manage can write story candidates" on public.frfc_story_candidates
  for insert to authenticated with check (frfc_has_permission(auth.uid(), 'editorial_queue.manage'));
create policy "editorial_queue.manage can update story candidates" on public.frfc_story_candidates
  for update to authenticated using (frfc_has_permission(auth.uid(), 'editorial_queue.manage')) with check (frfc_has_permission(auth.uid(), 'editorial_queue.manage'));
create policy "editorial_queue.manage can delete story candidates" on public.frfc_story_candidates
  for delete to authenticated using (frfc_has_permission(auth.uid(), 'editorial_queue.manage'));

drop policy "admins can do everything with evidence items" on public.frfc_evidence_items;
create policy "admins can read evidence items" on public.frfc_evidence_items
  for select to authenticated using (frfc_is_admin());
create policy "editorial_queue.manage can write evidence items" on public.frfc_evidence_items
  for insert to authenticated with check (frfc_has_permission(auth.uid(), 'editorial_queue.manage'));
create policy "editorial_queue.manage can update evidence items" on public.frfc_evidence_items
  for update to authenticated using (frfc_has_permission(auth.uid(), 'editorial_queue.manage')) with check (frfc_has_permission(auth.uid(), 'editorial_queue.manage'));
create policy "editorial_queue.manage can delete evidence items" on public.frfc_evidence_items
  for delete to authenticated using (frfc_has_permission(auth.uid(), 'editorial_queue.manage'));

drop policy "admins can insert candidate status log" on public.frfc_candidate_status_log;
create policy "editorial_queue.manage can insert candidate status log" on public.frfc_candidate_status_log
  for insert to authenticated with check (frfc_has_permission(auth.uid(), 'editorial_queue.manage'));

drop policy "admins_read_log" on public.frfc_admin_log;
create policy "logs.view can read admin log" on public.frfc_admin_log
  for select to authenticated using (frfc_has_permission(auth.uid(), 'logs.view'));

drop policy "admins can read job runs" on public.frfc_job_runs;
create policy "health.view can read job runs" on public.frfc_job_runs
  for select to authenticated using (frfc_has_permission(auth.uid(), 'health.view'));
