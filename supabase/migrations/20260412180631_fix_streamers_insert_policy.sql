
DROP POLICY "frfc_streamers_insert_authenticated" ON frfc_streamers;
CREATE POLICY "frfc_streamers_insert_authenticated" ON frfc_streamers
  FOR INSERT TO authenticated
  WITH CHECK (true);
