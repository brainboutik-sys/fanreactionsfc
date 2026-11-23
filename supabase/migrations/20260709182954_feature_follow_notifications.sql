
-- ═══════════════════════════════════════════════════════════════════════
-- Follow notifications for feature requests.
-- When an admin changes a request's status, followers get an email via
-- the notify-feature-status edge function (Resend, same mechanism as
-- notify-submission). notified_status makes sends idempotent: the edge
-- function only emails when status <> notified_status, then records it —
-- so replayed/spoofed invocations are no-ops.
-- ═══════════════════════════════════════════════════════════════════════

-- 1. Idempotency marker (server-managed; guarded from client writes below)
ALTER TABLE public.frfc_feature_requests
  ADD COLUMN IF NOT EXISTS notified_status text;
-- Backfill so pre-existing rows don't fire a spurious "notification" for
-- their current status on the first future call.
UPDATE public.frfc_feature_requests SET notified_status = status WHERE notified_status IS NULL;

-- 2. Protect notified_status from end-user writes (extend existing guard)
CREATE OR REPLACE FUNCTION public.frfc_tg_request_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  IF pg_trigger_depth() = 1
     AND auth.role() IN ('anon','authenticated')
     AND NOT public.frfc_is_admin() THEN
    NEW.vote_count        := OLD.vote_count;
    NEW.comment_count     := OLD.comment_count;
    NEW.is_pinned         := OLD.is_pinned;
    NEW.is_locked         := OLD.is_locked;
    NEW.status            := OLD.status;
    NEW.admin_response    := OLD.admin_response;
    NEW.admin_response_at := OLD.admin_response_at;
    NEW.merged_into       := OLD.merged_into;
    NEW.user_id           := OLD.user_id;
    NEW.created_at        := OLD.created_at;
    NEW.notified_status   := OLD.notified_status;
  END IF;
  RETURN NEW;
END;
$$;

-- 3. Follower emails — service-role only (never exposable to the browser:
--    it joins auth.users and returns raw email addresses)
CREATE OR REPLACE FUNCTION public.frfc_feature_follower_emails(p_feature_id uuid)
RETURNS TABLE(email text) LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT u.email::text
  FROM public.frfc_feature_follows f
  JOIN auth.users u ON u.id = f.user_id
  WHERE f.feature_id = p_feature_id AND u.email IS NOT NULL;
$$;
REVOKE EXECUTE ON FUNCTION public.frfc_feature_follower_emails(uuid) FROM PUBLIC, anon, authenticated;

-- 4. Fire the edge function on real status changes (same fire-and-forget
--    pattern as notify_new_submission; never blocks the admin's update)
CREATE OR REPLACE FUNCTION public.notify_feature_status_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  PERFORM extensions.http_post(
    'https://dsxijgrpxsfywxuffbmt.supabase.co/functions/v1/notify-feature-status',
    jsonb_build_object('feature_id', NEW.id),
    'application/json'
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Feature status notification failed: %', SQLERRM;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_frfc_notify_status ON public.frfc_feature_requests;
CREATE TRIGGER trg_frfc_notify_status
  AFTER UPDATE OF status ON public.frfc_feature_requests
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.notify_feature_status_change();
