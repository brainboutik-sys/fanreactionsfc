CREATE TABLE frfc_subscriber_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL REFERENCES frfc_streamers(id) ON DELETE CASCADE,
  subscriber_count integer NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_sub_history_creator_date ON frfc_subscriber_history(creator_id, recorded_at DESC);
ALTER TABLE frfc_subscriber_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_sub_history" ON frfc_subscriber_history FOR SELECT TO anon, authenticated USING (true);