CREATE OR REPLACE FUNCTION public.get_battle_all_stats()
RETURNS TABLE(creator_id uuid, wins bigint, losses bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH w AS (
    SELECT winner_id AS cid, COUNT(*) AS n FROM frfc_battles GROUP BY winner_id
  ),
  l AS (
    SELECT loser_id AS cid, COUNT(*) AS n FROM frfc_battles GROUP BY loser_id
  )
  SELECT COALESCE(w.cid, l.cid) AS creator_id, COALESCE(w.n, 0) AS wins, COALESCE(l.n, 0) AS losses
  FROM w FULL OUTER JOIN l ON w.cid = l.cid;
$$;

GRANT EXECUTE ON FUNCTION public.get_battle_all_stats() TO anon, authenticated;