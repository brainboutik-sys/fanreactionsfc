
-- Enable RLS on all tables
ALTER TABLE public.frfc_feature_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.frfc_feature_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.frfc_feature_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.frfc_feature_comment_likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.frfc_feature_follows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.frfc_feature_status_log ENABLE ROW LEVEL SECURITY;

-- Feature requests: anyone can read non-merged, auth users can insert their own
CREATE POLICY "Anyone can read feature requests" ON public.frfc_feature_requests FOR SELECT USING (true);
CREATE POLICY "Auth users can insert feature requests" ON public.frfc_feature_requests FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own requests" ON public.frfc_feature_requests FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Votes: anyone can read, auth users can insert/delete their own
CREATE POLICY "Anyone can read votes" ON public.frfc_feature_votes FOR SELECT USING (true);
CREATE POLICY "Auth users can vote" ON public.frfc_feature_votes FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can remove own vote" ON public.frfc_feature_votes FOR DELETE USING (auth.uid() = user_id);

-- Comments: anyone can read, auth users can insert their own
CREATE POLICY "Anyone can read comments" ON public.frfc_feature_comments FOR SELECT USING (true);
CREATE POLICY "Auth users can comment" ON public.frfc_feature_comments FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own comments" ON public.frfc_feature_comments FOR UPDATE USING (auth.uid() = user_id);

-- Comment likes
CREATE POLICY "Anyone can read comment likes" ON public.frfc_feature_comment_likes FOR SELECT USING (true);
CREATE POLICY "Auth users can like" ON public.frfc_feature_comment_likes FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can unlike" ON public.frfc_feature_comment_likes FOR DELETE USING (auth.uid() = user_id);

-- Follows
CREATE POLICY "Anyone can read follows" ON public.frfc_feature_follows FOR SELECT USING (true);
CREATE POLICY "Auth users can follow" ON public.frfc_feature_follows FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can unfollow" ON public.frfc_feature_follows FOR DELETE USING (auth.uid() = user_id);

-- Status log: anyone can read
CREATE POLICY "Anyone can read status log" ON public.frfc_feature_status_log FOR SELECT USING (true);
CREATE POLICY "Auth users can insert status log" ON public.frfc_feature_status_log FOR INSERT WITH CHECK (auth.uid() = changed_by);

-- Admin policies: admins can update any feature request and insert official comments
-- (Admin check via frfc_admin_roles table)
CREATE POLICY "Admins can update any feature request" ON public.frfc_feature_requests FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.frfc_admin_roles WHERE user_id = auth.uid()));
CREATE POLICY "Admins can delete feature requests" ON public.frfc_feature_requests FOR DELETE
  USING (EXISTS (SELECT 1 FROM public.frfc_admin_roles WHERE user_id = auth.uid()));

-- RPC: increment/decrement vote count atomically
CREATE OR REPLACE FUNCTION public.frfc_feature_vote_up(p_feature_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.frfc_feature_requests SET vote_count = vote_count + 1, updated_at = now() WHERE id = p_feature_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.frfc_feature_vote_down(p_feature_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.frfc_feature_requests SET vote_count = GREATEST(vote_count - 1, 0), updated_at = now() WHERE id = p_feature_id;
END;
$$;

-- RPC: increment/decrement comment count
CREATE OR REPLACE FUNCTION public.frfc_feature_comment_added(p_feature_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.frfc_feature_requests SET comment_count = comment_count + 1, updated_at = now() WHERE id = p_feature_id;
END;
$$;

-- RPC: merge duplicates — transfer votes and redirect
CREATE OR REPLACE FUNCTION public.frfc_feature_merge(p_source_id uuid, p_target_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Move votes that don't already exist on target
  INSERT INTO public.frfc_feature_votes (feature_id, user_id)
    SELECT p_target_id, user_id FROM public.frfc_feature_votes
    WHERE feature_id = p_source_id
    ON CONFLICT (feature_id, user_id) DO NOTHING;
  -- Delete source votes
  DELETE FROM public.frfc_feature_votes WHERE feature_id = p_source_id;
  -- Recount target votes
  UPDATE public.frfc_feature_requests SET vote_count = (
    SELECT count(*) FROM public.frfc_feature_votes WHERE feature_id = p_target_id
  ) WHERE id = p_target_id;
  -- Mark source as merged
  UPDATE public.frfc_feature_requests SET merged_into = p_target_id, status = 'declined', updated_at = now() WHERE id = p_source_id;
END;
$$;
