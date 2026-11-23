
-- Add league column to frfc_streamers
ALTER TABLE frfc_streamers ADD COLUMN IF NOT EXISTS league TEXT DEFAULT 'Premier League';

-- Update existing records to Premier League (they're all PL currently)
UPDATE frfc_streamers SET league = 'Premier League' WHERE league IS NULL;
