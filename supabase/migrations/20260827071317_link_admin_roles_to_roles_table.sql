
alter table public.frfc_admin_roles
  add constraint frfc_admin_roles_role_fkey foreign key (role) references public.frfc_roles(slug);

create or replace function public.frfc_has_permission(p_user_id uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $$
  select exists (
    select 1
    from public.frfc_admin_roles ar
    join public.frfc_role_permissions rp on rp.role_slug = ar.role
    where ar.user_id = p_user_id and rp.permission_key = p_permission
  );
$$;

create policy "roles.manage can write roles" on public.frfc_roles
  for insert to authenticated with check (frfc_has_permission(auth.uid(), 'roles.manage'));
create policy "roles.manage can update roles" on public.frfc_roles
  for update to authenticated using (frfc_has_permission(auth.uid(), 'roles.manage')) with check (frfc_has_permission(auth.uid(), 'roles.manage'));
create policy "roles.manage can delete non-system roles" on public.frfc_roles
  for delete to authenticated using (frfc_has_permission(auth.uid(), 'roles.manage') and is_system = false);

create policy "roles.manage can write role permissions" on public.frfc_role_permissions
  for all to authenticated
  using (frfc_has_permission(auth.uid(), 'roles.manage'))
  with check (frfc_has_permission(auth.uid(), 'roles.manage'));
