
insert into public.frfc_roles (slug, name, description, is_system) values
  ('super_admin', 'Super Admin', 'Full application access, including user/role management and destructive actions.', true),
  ('admin', 'Admin', 'Manages users, content, and settings. Cannot manage roles, delete user accounts, or perform destructive actions.', true),
  ('editor', 'Editor', 'Can create and edit content and manage the editorial queue. No user or role management.', true);

-- Super Admin: every permission in the catalog
insert into public.frfc_role_permissions (role_slug, permission_key)
select 'super_admin', key from public.frfc_permissions;

-- Admin: everything except roles.manage, users.delete, database.destructive_actions
insert into public.frfc_role_permissions (role_slug, permission_key)
select 'admin', key from public.frfc_permissions
where key not in ('roles.manage', 'users.delete', 'database.destructive_actions');

-- Editor: create/edit content + editorial queue, no user/role/settings/destructive access
insert into public.frfc_role_permissions (role_slug, permission_key) values
  ('editor', 'articles.create'),
  ('editor', 'articles.edit'),
  ('editor', 'creators.edit'),
  ('editor', 'submissions.review'),
  ('editor', 'editorial_queue.manage');
