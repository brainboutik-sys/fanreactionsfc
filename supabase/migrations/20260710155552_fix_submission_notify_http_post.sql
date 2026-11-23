CREATE OR REPLACE FUNCTION notify_new_submission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM net.http_post(
    url := 'https://dsxijgrpxsfywxuffbmt.supabase.co/functions/v1/notify-submission',
    body := jsonb_build_object('record', row_to_json(NEW)),
    headers := '{"Content-Type": "application/json"}'::jsonb
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Submission notification failed: %', SQLERRM;
  RETURN NEW;
END;
$$;