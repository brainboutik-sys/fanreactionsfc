
-- Admin roles table: maps auth.users to admin roles
CREATE TABLE frfc_admin_roles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'super_admin')),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE frfc_admin_roles ENABLE ROW LEVEL SECURITY;

-- Only admins can read admin_roles
CREATE POLICY "admins_read_roles" ON frfc_admin_roles
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM frfc_admin_roles WHERE user_id = auth.uid()));

-- Activity log for admin actions
CREATE TABLE frfc_admin_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  action text NOT NULL,
  entity_type text,
  entity_id text,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE frfc_admin_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins_read_log" ON frfc_admin_log
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM frfc_admin_roles WHERE user_id = auth.uid()));

CREATE POLICY "admins_insert_log" ON frfc_admin_log
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM frfc_admin_roles WHERE user_id = auth.uid()));

-- Helper function to check admin status
CREATE OR REPLACE FUNCTION is_frfc_admin()
RETURNS boolean AS $$
  SELECT EXISTS (SELECT 1 FROM frfc_admin_roles WHERE user_id = auth.uid());
$$ LANGUAGE sql SECURITY DEFINER STABLE;
