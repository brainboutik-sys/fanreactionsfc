
-- record_battle_vote now returns both creators' win counts so the client
-- gets vote + stats in ONE round-trip (was 3: vote + 2x get_creator_battle_stats).
-- Counts are computed after the insert inside the same transaction, which
-- also fixes the old client-side +1 that double-counted the fresh vote.
-- All validation/rate-limit rules unchanged; rejected votes still insert
-- nothing but DO return current counts so the UI can render honestly.
DROP FUNCTION IF EXISTS public.record_battle_vote(uuid, uuid, text, uuid);

CREATE FUNCTION public.record_battle_vote(w_id uuid, l_id uuid, fp text, v_id uuid DEFAULT NULL)
RETURNS TABLE(winner_wins bigint, loser_wins bigint)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  valid boolean := true;
BEGIN
  -- Basic shape checks
  IF w_id IS NULL OR l_id IS NULL OR w_id = l_id THEN valid := false; END IF;
  IF valid AND (fp IS NULL OR char_length(fp) < 8 OR char_length(fp) > 64) THEN valid := false; END IF;

  -- Both sides must be real creators
  IF valid AND NOT EXISTS (SELECT 1 FROM public.frfc_streamers WHERE id = w_id) THEN valid := false; END IF;
  IF valid AND NOT EXISTS (SELECT 1 FROM public.frfc_streamers WHERE id = l_id) THEN valid := false; END IF;

  -- Hourly rate cap per fingerprint
  IF valid AND (SELECT count(*) FROM public.frfc_battles
      WHERE voter_fingerprint = fp
        AND created_at > now() - interval '1 hour') >= 300 THEN
    valid := false;
  END IF;

  -- Same-pair cooldown per fingerprint
  IF valid AND EXISTS (SELECT 1 FROM public.frfc_battles
             WHERE voter_fingerprint = fp
               AND created_at > now() - interval '2 minutes'
               AND ((winner_id = w_id AND loser_id = l_id)
                 OR (winner_id = l_id AND loser_id = w_id))) THEN
    valid := false;
  END IF;

  IF valid THEN
    -- voter_id from the session, never trusted from the client
    INSERT INTO public.frfc_battles (winner_id, loser_id, voter_fingerprint, voter_id)
    VALUES (w_id, l_id, fp, auth.uid());
  END IF;

  RETURN QUERY SELECT
    (SELECT count(*) FROM public.frfc_battles WHERE winner_id = w_id),
    (SELECT count(*) FROM public.frfc_battles WHERE winner_id = l_id);
END;
$$;
