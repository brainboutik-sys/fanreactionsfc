CREATE OR REPLACE FUNCTION notify_new_creator_report()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM net.http_post(
    url := 'https://dsxijgrpxsfywxuffbmt.supabase.co/functions/v1/notify-report',
    body := jsonb_build_object('record', row_to_json(NEW)),
    headers := '{"Content-Type": "application/json"}'::jsonb
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Creator report notification failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_new_creator_report
  AFTER INSERT ON frfc_creator_reports
  FOR EACH ROW EXECUTE FUNCTION notify_new_creator_report();

CREATE OR REPLACE FUNCTION notify_creator_claimed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.claimed_by IS NULL AND NEW.claimed_by IS NOT NULL THEN
    PERFORM net.http_post(
      url := 'https://dsxijgrpxsfywxuffbmt.supabase.co/functions/v1/notify-claim',
      body := jsonb_build_object('record', row_to_json(NEW)),
      headers := '{"Content-Type": "application/json"}'::jsonb
    );
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Creator claim notification failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_creator_claimed
  AFTER UPDATE ON frfc_streamers
  FOR EACH ROW
  WHEN (OLD.claimed_by IS DISTINCT FROM NEW.claimed_by)
  EXECUTE FUNCTION notify_creator_claimed();