
-- Guards apply only to end-user API roles (anon/authenticated).
-- Direct SQL, migrations, and service-role writes pass through.
CREATE OR REPLACE FUNCTION public.frfc_tg_comment_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  IF pg_trigger_depth() = 1
     AND auth.role() IN ('anon','authenticated')
     AND NOT public.frfc_is_admin() THEN
    NEW.like_count   := OLD.like_count;
    NEW.is_official  := OLD.is_official;
    NEW.user_id      := OLD.user_id;
    NEW.feature_id   := OLD.feature_id;
    NEW.parent_id    := OLD.parent_id;
    NEW.created_at   := OLD.created_at;
  END IF;
  RETURN NEW;
END;
$$;

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
  END IF;
  RETURN NEW;
END;
$$;

-- Same scoping for the is_official deriver: service-role/SQL inserts keep
-- whatever they specify; end-user inserts get the derived value.
CREATE OR REPLACE FUNCTION public.frfc_tg_comment_before_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  IF auth.role() IN ('anon','authenticated') THEN
    NEW.is_official := public.frfc_is_admin();
    NEW.like_count := 0;
  END IF;
  RETURN NEW;
END;
$$;

-- Re-run the counter resync now that guards no longer block direct SQL
UPDATE public.frfc_feature_requests r SET
  vote_count    = (SELECT count(*) FROM public.frfc_feature_votes v WHERE v.feature_id = r.id),
  comment_count = (SELECT count(*) FROM public.frfc_feature_comments c WHERE c.feature_id = r.id);
UPDATE public.frfc_feature_comments c SET
  like_count = (SELECT count(*) FROM public.frfc_feature_comment_likes l WHERE l.comment_id = c.id);
