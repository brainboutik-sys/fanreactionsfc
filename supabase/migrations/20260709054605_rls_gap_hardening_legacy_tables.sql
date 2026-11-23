
-- ═══════════════════════════════════════════════════════════════════════
-- Close pre-existing RLS gaps on the legacy tables. Reads stay public where
-- the site needs them; writes that were UI-gated only become admin-only.
-- Server-side Netlify functions use the service-role key (bypasses RLS) and
-- battle votes go through the SECURITY DEFINER record_battle_vote RPC (owned
-- by postgres, bypasses RLS), so neither is affected.
-- Admin checks mirror the proven pattern already used by frfc_feature_requests.
-- ═══════════════════════════════════════════════════════════════════════

-- ── frfc_streamers: reads public, writes admin-only ──
DROP POLICY IF EXISTS anon_update_streamers               ON public.frfc_streamers;
DROP POLICY IF EXISTS frfc_streamers_update_authenticated ON public.frfc_streamers;
DROP POLICY IF EXISTS frfc_streamers_insert_authenticated ON public.frfc_streamers;
DROP POLICY IF EXISTS frfc_streamers_delete_authenticated ON public.frfc_streamers;

CREATE POLICY "Admins insert streamers" ON public.frfc_streamers FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.frfc_admin_roles WHERE user_id = auth.uid()));
CREATE POLICY "Admins update streamers" ON public.frfc_streamers FOR UPDATE TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.frfc_admin_roles WHERE user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.frfc_admin_roles WHERE user_id = auth.uid()));
CREATE POLICY "Admins delete streamers" ON public.frfc_streamers FOR DELETE TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.frfc_admin_roles WHERE user_id = auth.uid()));

-- ── frfc_submissions: public submit + read stay; approve/reject admin-only ──
DROP POLICY IF EXISTS auth_update_submissions ON public.frfc_submissions;
DROP POLICY IF EXISTS auth_delete_submissions ON public.frfc_submissions;

CREATE POLICY "Admins update submissions" ON public.frfc_submissions FOR UPDATE TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.frfc_admin_roles WHERE user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.frfc_admin_roles WHERE user_id = auth.uid()));
CREATE POLICY "Admins delete submissions" ON public.frfc_submissions FOR DELETE TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.frfc_admin_roles WHERE user_id = auth.uid()));

-- ── frfc_creator_reports: public report stays; read/triage admin-only ──
DROP POLICY IF EXISTS auth_read_reports   ON public.frfc_creator_reports;
DROP POLICY IF EXISTS auth_update_reports ON public.frfc_creator_reports;

CREATE POLICY "Admins read reports" ON public.frfc_creator_reports FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.frfc_admin_roles WHERE user_id = auth.uid()));
CREATE POLICY "Admins update reports" ON public.frfc_creator_reports FOR UPDATE TO authenticated
  USING      (EXISTS (SELECT 1 FROM public.frfc_admin_roles WHERE user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.frfc_admin_roles WHERE user_id = auth.uid()));

-- ── frfc_battles: direct inserts closed; votes only via record_battle_vote ──
DROP POLICY IF EXISTS frfc_battles_insert_all ON public.frfc_battles;
-- SELECT (frfc_battles_select_all) stays public.

-- ── frfc_subscriber_history: reads public; inserts admin-only (server uses
--    service role and bypasses this; admin manual sync runs as admin) ──
DROP POLICY IF EXISTS anon_insert_sub_history ON public.frfc_subscriber_history;
CREATE POLICY "Admins insert sub history" ON public.frfc_subscriber_history FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.frfc_admin_roles WHERE user_id = auth.uid()));
