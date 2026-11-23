
-- Enable pg_net for HTTP calls from triggers
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Function to call the edge function on new submission
CREATE OR REPLACE FUNCTION notify_new_submission()
RETURNS trigger AS $$
DECLARE
  edge_url text;
  service_key text;
BEGIN
  edge_url := current_setting('app.settings.supabase_url', true) || '/functions/v1/notify-submission';
  service_key := current_setting('app.settings.service_role_key', true);
  
  -- Use direct URL since app.settings may not be available
  PERFORM extensions.http_post(
    'https://dsxijgrpxsfywxuffbmt.supabase.co/functions/v1/notify-submission',
    jsonb_build_object('record', row_to_json(NEW)),
    'application/json'
  );
  
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Don't block the insert if notification fails
  RAISE WARNING 'Submission notification failed: %', SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_new_submission
  AFTER INSERT ON frfc_submissions
  FOR EACH ROW
  EXECUTE FUNCTION notify_new_submission();
