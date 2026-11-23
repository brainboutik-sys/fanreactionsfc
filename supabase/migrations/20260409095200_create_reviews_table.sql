CREATE TABLE frfc_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id UUID NOT NULL REFERENCES frfc_streamers(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rating SMALLINT NOT NULL CHECK (rating >= 1 AND rating <= 5),
  review_text TEXT,
  helpful_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(creator_id, user_id)
);

ALTER TABLE frfc_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY reviews_read ON frfc_reviews FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY reviews_insert ON frfc_reviews FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY reviews_update ON frfc_reviews FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY reviews_delete ON frfc_reviews FOR DELETE TO authenticated USING (auth.uid() = user_id);