
-- ═══════════════════════════════════════════════════════════════════════
-- Battle vote hardening.
-- Old function inserted anything: no creator validation, client-supplied
-- voter_id, unlimited rate. New rules:
--   • winner/loser must be distinct, existing creators
--   • voter_id comes from the JWT (auth.uid()), never from the client
--   • max 300 votes per fingerprint per hour (UI allows ~1 vote / 2s,
--     so real users never hit this; scripts stuffing thousands do)
--   • same matchup can't be re-voted by the same fingerprint within
--     2 minutes (the UI never shows the same pair twice in a session)
-- Abusive calls return silently — no signal to the attacker, no console
-- errors for edge-case legitimate users.
-- ═══════════════════════════════════════════════════════════════════════

-- Drop the legacy 3-arg overload (pre-voter_id)
DROP FUNCTION IF EXISTS public.record_battle_vote(uuid, uuid, text);

CREATE OR REPLACE FUNCTION public.record_battle_vote(w_id uuid, l_id uuid, fp text, v_id uuid DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  -- Basic shape checks
  IF w_id IS NULL OR l_id IS NULL OR w_id = l_id THEN RETURN; END IF;
  IF fp IS NULL OR char_length(fp) < 8 OR char_length(fp) > 64 THEN RETURN; END IF;

  -- Both sides must be real creators
  IF NOT EXISTS (SELECT 1 FROM public.frfc_streamers WHERE id = w_id) THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.frfc_streamers WHERE id = l_id) THEN RETURN; END IF;

  -- Hourly rate cap per fingerprint
  IF (SELECT count(*) FROM public.frfc_battles
      WHERE voter_fingerprint = fp
        AND created_at > now() - interval '1 hour') >= 300 THEN
    RETURN;
  END IF;

  -- Same-pair cooldown per fingerprint
  IF EXISTS (SELECT 1 FROM public.frfc_battles
             WHERE voter_fingerprint = fp
               AND created_at > now() - interval '2 minutes'
               AND ((winner_id = w_id AND loser_id = l_id)
                 OR (winner_id = l_id AND loser_id = w_id))) THEN
    RETURN;
  END IF;

  -- voter_id is taken from the session, never trusted from the client
  INSERT INTO public.frfc_battles (winner_id, loser_id, voter_fingerprint, voter_id)
  VALUES (w_id, l_id, fp, auth.uid());
END;
$$;

-- Index to keep the rate-limit lookups cheap as the table grows
CREATE INDEX IF NOT EXISTS idx_frfc_battles_fp_created
  ON public.frfc_battles (voter_fingerprint, created_at DESC);
