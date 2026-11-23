
CREATE TABLE frfc_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  channel_url text NOT NULL,
  team text NOT NULL,
  league text NOT NULL DEFAULT 'Premier League',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES auth.users(id)
);

ALTER TABLE frfc_submissions ENABLE ROW LEVEL SECURITY;

-- Anyone can read and insert (public submission)
CREATE POLICY "anon_read_submissions" ON frfc_submissions FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "anon_insert_submissions" ON frfc_submissions FOR INSERT TO anon, authenticated WITH CHECK (true);
-- Only admins can update (approve/reject)
CREATE POLICY "auth_update_submissions" ON frfc_submissions FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_delete_submissions" ON frfc_submissions FOR DELETE TO authenticated USING (true);
