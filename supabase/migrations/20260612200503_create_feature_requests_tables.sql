
-- Feature requests
CREATE TABLE public.frfc_feature_requests (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) >= 5),
  description text NOT NULL CHECK (char_length(description) >= 20),
  category text NOT NULL DEFAULT 'Other',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','under_review','planned','in_development','released','declined')),
  vote_count int NOT NULL DEFAULT 0,
  comment_count int NOT NULL DEFAULT 0,
  is_pinned boolean NOT NULL DEFAULT false,
  is_locked boolean NOT NULL DEFAULT false,
  merged_into uuid REFERENCES public.frfc_feature_requests(id) ON DELETE SET NULL,
  admin_response text,
  admin_response_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Votes
CREATE TABLE public.frfc_feature_votes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  feature_id uuid NOT NULL REFERENCES public.frfc_feature_requests(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(feature_id, user_id)
);

-- Comments
CREATE TABLE public.frfc_feature_comments (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  feature_id uuid NOT NULL REFERENCES public.frfc_feature_requests(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES public.frfc_feature_comments(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (char_length(body) >= 1),
  is_official boolean NOT NULL DEFAULT false,
  like_count int NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Comment likes
CREATE TABLE public.frfc_feature_comment_likes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  comment_id uuid NOT NULL REFERENCES public.frfc_feature_comments(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(comment_id, user_id)
);

-- Follows
CREATE TABLE public.frfc_feature_follows (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  feature_id uuid NOT NULL REFERENCES public.frfc_feature_requests(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(feature_id, user_id)
);

-- Status change history
CREATE TABLE public.frfc_feature_status_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  feature_id uuid NOT NULL REFERENCES public.frfc_feature_requests(id) ON DELETE CASCADE,
  old_status text,
  new_status text NOT NULL,
  changed_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  note text,
  created_at timestamptz DEFAULT now()
);

-- Indexes
CREATE INDEX idx_feature_requests_status ON public.frfc_feature_requests(status);
CREATE INDEX idx_feature_requests_category ON public.frfc_feature_requests(category);
CREATE INDEX idx_feature_requests_vote_count ON public.frfc_feature_requests(vote_count DESC);
CREATE INDEX idx_feature_requests_created ON public.frfc_feature_requests(created_at DESC);
CREATE INDEX idx_feature_requests_user ON public.frfc_feature_requests(user_id);
CREATE INDEX idx_feature_votes_feature ON public.frfc_feature_votes(feature_id);
CREATE INDEX idx_feature_votes_user ON public.frfc_feature_votes(user_id);
CREATE INDEX idx_feature_comments_feature ON public.frfc_feature_comments(feature_id);
CREATE INDEX idx_feature_follows_feature ON public.frfc_feature_follows(feature_id);
CREATE INDEX idx_feature_status_log_feature ON public.frfc_feature_status_log(feature_id);
