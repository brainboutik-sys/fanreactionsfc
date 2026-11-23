
-- Use the correct pg_net signature (named args). The 3-arg
-- extensions.http_post(url, body, 'application/json') form doesn't
-- type-check against net.http_post(url, body jsonb, params jsonb, ...),
-- so the previous version silently failed inside the exception handler.
CREATE OR REPLACE FUNCTION public.notify_feature_status_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  PERFORM net.http_post(
    url := 'https://dsxijgrpxsfywxuffbmt.supabase.co/functions/v1/notify-feature-status',
    body := jsonb_build_object('feature_id', NEW.id),
    headers := '{"Content-Type": "application/json"}'::jsonb
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Feature status notification failed: %', SQLERRM;
  RETURN NEW;
END;
$$;
