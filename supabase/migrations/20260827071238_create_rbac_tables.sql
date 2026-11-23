
create table public.frfc_permissions (
  key text primary key,
  category text not null,
  label text not null,
  description text
);

create table public.frfc_roles (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  description text,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.frfc_role_permissions (
  role_slug text not null references public.frfc_roles(slug) on delete cascade,
  permission_key text not null references public.frfc_permissions(key) on delete cascade,
  primary key (role_slug, permission_key)
);

alter table public.frfc_permissions enable row level security;
alter table public.frfc_roles enable row level security;
alter table public.frfc_role_permissions enable row level security;

create policy "admins can read permissions catalog" on public.frfc_permissions
  for select to authenticated using (frfc_is_admin());

create policy "admins can read roles" on public.frfc_roles
  for select to authenticated using (frfc_is_admin());

create policy "admins can read role permissions" on public.frfc_role_permissions
  for select to authenticated using (frfc_is_admin());
