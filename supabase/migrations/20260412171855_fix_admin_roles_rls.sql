
-- Drop the broken recursive policy
DROP POLICY "admins_read_roles" ON frfc_admin_roles;

-- Allow authenticated users to read their OWN row (needed for the admin check)
CREATE POLICY "users_read_own_role" ON frfc_admin_roles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());
