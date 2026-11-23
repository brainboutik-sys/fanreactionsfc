
-- ═══════════════════════════════════════════════════════════════════════
-- Feature-requests integrity hardening.
-- Counts move from client-callable RPCs into row triggers; protected
-- columns are guarded against direct client UPDATEs; is_official is
-- server-derived; text fields get upper length caps; merge becomes
-- admin-only.
-- ═══════════════════════════════════════════════════════════════════════

-- 0. Helper: is the current JWT an admin?
CREATE OR REPLACE FUNCTION public.frfc_is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.frfc_admin_roles WHERE user_id = auth.uid());
$$;

-- 1. Length caps (client already enforces minimums; DB now caps maximums)
ALTER TABLE public.frfc_feature_requests
  ADD CONSTRAINT frfc_feature_title_max CHECK (char_length(title) <= 120),
  ADD CONSTRAINT frfc_feature_description_max CHECK (char_length(description) <= 5000);
ALTER TABLE public.frfc_feature_comments
  ADD CONSTRAINT frfc_feature_comment_body_max CHECK (char_length(body) <= 2000);

-- 2. Vote count maintained by trigger (atomic with the vote row itself)
CREATE OR REPLACE FUNCTION public.frfc_tg_vote_count()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.frfc_feature_requests
      SET vote_count = vote_count + 1, updated_at = now()
      WHERE id = NEW.feature_id;
    RETURN NEW;
  ELSE
    UPDATE public.frfc_feature_requests
      SET vote_count = GREATEST(vote_count - 1, 0), updated_at = now()
      WHERE id = OLD.feature_id;
    RETURN OLD;
  END IF;
END;
$$;
DROP TRIGGER IF EXISTS trg_frfc_vote_count ON public.frfc_feature_votes;
CREATE TRIGGER trg_frfc_vote_count
  AFTER INSERT OR DELETE ON public.frfc_feature_votes
  FOR EACH ROW EXECUTE FUNCTION public.frfc_tg_vote_count();

-- 3. Comment count maintained by trigger
CREATE OR REPLACE FUNCTION public.frfc_tg_comment_count()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.frfc_feature_requests
      SET comment_count = comment_count + 1, updated_at = now()
      WHERE id = NEW.feature_id;
    RETURN NEW;
  ELSE
    UPDATE public.frfc_feature_requests
      SET comment_count = GREATEST(comment_count - 1, 0), updated_at = now()
      WHERE id = OLD.feature_id;
    RETURN OLD;
  END IF;
END;
$$;
DROP TRIGGER IF EXISTS trg_frfc_comment_count ON public.frfc_feature_comments;
CREATE TRIGGER trg_frfc_comment_count
  AFTER INSERT OR DELETE ON public.frfc_feature_comments
  FOR EACH ROW EXECUTE FUNCTION public.frfc_tg_comment_count();

-- 4. Like count maintained by trigger
CREATE OR REPLACE FUNCTION public.frfc_tg_like_count()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.frfc_feature_comments
      SET like_count = like_count + 1 WHERE id = NEW.comment_id;
    RETURN NEW;
  ELSE
    UPDATE public.frfc_feature_comments
      SET like_count = GREATEST(like_count - 1, 0) WHERE id = OLD.comment_id;
    RETURN OLD;
  END IF;
END;
$$;
DROP TRIGGER IF EXISTS trg_frfc_like_count ON public.frfc_feature_comment_likes;
CREATE TRIGGER trg_frfc_like_count
  AFTER INSERT OR DELETE ON public.frfc_feature_comment_likes
  FOR EACH ROW EXECUTE FUNCTION public.frfc_tg_like_count();

-- 5. is_official is derived server-side; clients cannot assert it
CREATE OR REPLACE FUNCTION public.frfc_tg_comment_before_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  NEW.is_official := public.frfc_is_admin();
  NEW.like_count := 0;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_frfc_comment_before_insert ON public.frfc_feature_comments;
CREATE TRIGGER trg_frfc_comment_before_insert
  BEFORE INSERT ON public.frfc_feature_comments
  FOR EACH ROW EXECUTE FUNCTION public.frfc_tg_comment_before_insert();

-- 6. Guard protected comment columns on direct client UPDATEs.
-- pg_trigger_depth() = 1 means the UPDATE came straight from a client
-- statement; our count triggers issue UPDATEs at depth 2 and pass through.
CREATE OR REPLACE FUNCTION public.frfc_tg_comment_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  IF pg_trigger_depth() = 1 AND NOT public.frfc_is_admin() THEN
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
DROP TRIGGER IF EXISTS trg_frfc_comment_guard ON public.frfc_feature_comments;
CREATE TRIGGER trg_frfc_comment_guard
  BEFORE UPDATE ON public.frfc_feature_comments
  FOR EACH ROW EXECUTE FUNCTION public.frfc_tg_comment_guard();

-- 7. Guard protected feature-request columns: owners may edit only
-- title/description/category; everything moderation-ish is admin-only.
CREATE OR REPLACE FUNCTION public.frfc_tg_request_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  IF pg_trigger_depth() = 1 AND NOT public.frfc_is_admin() THEN
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
DROP TRIGGER IF EXISTS trg_frfc_request_guard ON public.frfc_feature_requests;
CREATE TRIGGER trg_frfc_request_guard
  BEFORE UPDATE ON public.frfc_feature_requests
  FOR EACH ROW EXECUTE FUNCTION public.frfc_tg_request_guard();

-- 8. Drop the abusable count RPCs (counts are trigger-owned now)
DROP FUNCTION IF EXISTS public.frfc_feature_vote_up(uuid);
DROP FUNCTION IF EXISTS public.frfc_feature_vote_down(uuid);
DROP FUNCTION IF EXISTS public.frfc_feature_comment_added(uuid);

-- 9. Merge is admin-only now
CREATE OR REPLACE FUNCTION public.frfc_feature_merge(p_source_id uuid, p_target_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  IF NOT public.frfc_is_admin() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  IF p_source_id = p_target_id THEN
    RAISE EXCEPTION 'cannot merge a request into itself';
  END IF;
  INSERT INTO public.frfc_feature_votes (feature_id, user_id)
    SELECT p_target_id, user_id FROM public.frfc_feature_votes
    WHERE feature_id = p_source_id
    ON CONFLICT (feature_id, user_id) DO NOTHING;
  DELETE FROM public.frfc_feature_votes WHERE feature_id = p_source_id;
  -- Triggers keep vote_count in sync during the moves above; recount both
  -- ends anyway so a merge always leaves exact numbers.
  UPDATE public.frfc_feature_requests r SET vote_count = (
    SELECT count(*) FROM public.frfc_feature_votes v WHERE v.feature_id = r.id
  ) WHERE r.id IN (p_source_id, p_target_id);
  UPDATE public.frfc_feature_requests
    SET merged_into = p_target_id, status = 'declined', updated_at = now()
    WHERE id = p_source_id;
END;
$$;

-- 10. One-time resync of all counters from actual rows
UPDATE public.frfc_feature_requests r SET
  vote_count    = (SELECT count(*) FROM public.frfc_feature_votes v WHERE v.feature_id = r.id),
  comment_count = (SELECT count(*) FROM public.frfc_feature_comments c WHERE c.feature_id = r.id);
UPDATE public.frfc_feature_comments c SET
  like_count = (SELECT count(*) FROM public.frfc_feature_comment_likes l WHERE l.comment_id = c.id);
