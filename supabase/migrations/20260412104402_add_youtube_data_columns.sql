ALTER TABLE frfc_streamers
  ADD COLUMN IF NOT EXISTS youtube_channel_id text,
  ADD COLUMN IF NOT EXISTS total_view_count bigint,
  ADD COLUMN IF NOT EXISTS video_count integer,
  ADD COLUMN IF NOT EXISTS channel_created_at timestamptz,
  ADD COLUMN IF NOT EXISTS latest_video_id text,
  ADD COLUMN IF NOT EXISTS latest_video_title text,
  ADD COLUMN IF NOT EXISTS latest_video_date timestamptz,
  ADD COLUMN IF NOT EXISTS latest_video_views integer,
  ADD COLUMN IF NOT EXISTS latest_video_thumbnail text,
  ADD COLUMN IF NOT EXISTS is_live boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS live_video_id text,
  ADD COLUMN IF NOT EXISTS upload_frequency text,
  ADD COLUMN IF NOT EXISTS last_youtube_sync timestamptz;