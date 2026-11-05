-- =================================================================================
-- REFONTE ET MODERNISATION DE BÉNIN CONNECT (https://benin-connect.com)
-- Script SQL Additif & Non-Destructif (Sécurité RLS incluse)
-- Réutilise les tables existantes : profiles, vendors, products, categories,
-- reviews, notifications, et les tables jds_* (JDS PARTENAIRES).
-- =================================================================================

-- 1. TABLE : platform_followers (Section 6 — Suivre Bénin Connect)
CREATE TABLE IF NOT EXISTS public.platform_followers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  email TEXT,
  full_name TEXT,
  city TEXT DEFAULT 'Parakou',
  receive_news BOOLEAN DEFAULT true,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT platform_followers_user_unique UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_platform_followers_active ON public.platform_followers(is_active);
CREATE INDEX IF NOT EXISTS idx_platform_followers_created ON public.platform_followers(created_at DESC);

ALTER TABLE public.platform_followers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Lecture publique du nombre d'abonnes" ON public.platform_followers;
CREATE POLICY "Lecture publique du nombre d'abonnes"
  ON public.platform_followers FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Insertion abonnement utilisateur" ON public.platform_followers;
CREATE POLICY "Insertion abonnement utilisateur"
  ON public.platform_followers FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Modification abonnement utilisateur" ON public.platform_followers;
CREATE POLICY "Modification abonnement utilisateur"
  ON public.platform_followers FOR UPDATE
  USING (auth.uid() = user_id OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('super_admin', 'admin', 'regional_admin')));

DROP POLICY IF EXISTS "Suppression abonnement utilisateur" ON public.platform_followers;
CREATE POLICY "Suppression abonnement utilisateur"
  ON public.platform_followers FOR DELETE
  USING (auth.uid() = user_id OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('super_admin', 'admin')));

-- 2. TABLE : platform_reviews (Sections 7 & 8 — Avis Bénin Connect, Marché d'Aujourd'hui & App Mobile)
CREATE TABLE IF NOT EXISTS public.platform_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  author_name TEXT NOT NULL,
  author_role TEXT DEFAULT 'Membre Bénin Connect',
  author_city TEXT DEFAULT 'Parakou',
  target_type TEXT NOT NULL CHECK (target_type IN ('benin_connect', 'marche_aujourdhui', 'mobile_app')),
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('approved', 'pending', 'reported', 'rejected')),
  report_count INTEGER DEFAULT 0,
  report_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT platform_reviews_user_target_unique UNIQUE (user_id, target_type)
);

CREATE INDEX IF NOT EXISTS idx_platform_reviews_target_status ON public.platform_reviews(target_type, status, created_at DESC);

ALTER TABLE public.platform_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Lecture publique des avis valides" ON public.platform_reviews;
CREATE POLICY "Lecture publique des avis valides"
  ON public.platform_reviews FOR SELECT
  USING (status = 'approved' OR auth.uid() = user_id OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('super_admin', 'admin', 'regional_admin')));

DROP POLICY IF EXISTS "Insertion avis par utilisateur connecte" ON public.platform_reviews;
CREATE POLICY "Insertion avis par utilisateur connecte"
  ON public.platform_reviews FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Mise a jour avis ou signalement" ON public.platform_reviews;
CREATE POLICY "Mise a jour avis ou signalement"
  ON public.platform_reviews FOR UPDATE
  USING (true);

DROP POLICY IF EXISTS "Suppression avis par admin" ON public.platform_reviews;
CREATE POLICY "Suppression avis par admin"
  ON public.platform_reviews FOR DELETE
  USING (auth.uid() = user_id OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('super_admin', 'admin')));

-- 3. TABLE : platform_news (Section 9 — Actualités Bénin Connect)
CREATE TABLE IF NOT EXISTS public.platform_news (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'nouveaute' CHECK (category IN ('nouveaute', 'vendeur', 'partenaire', 'evenement', 'annonce', 'fonctionnalite')),
  badge_label TEXT DEFAULT 'Actualité',
  image_url TEXT,
  cta_label TEXT DEFAULT 'En savoir plus',
  cta_url TEXT DEFAULT '#marche',
  is_published BOOLEAN DEFAULT true,
  author_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_news_published ON public.platform_news(is_published, created_at DESC);

ALTER TABLE public.platform_news ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Lecture publique des actualites publiees" ON public.platform_news;
CREATE POLICY "Lecture publique des actualites publiees"
  ON public.platform_news FOR SELECT
  USING (is_published = true OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('super_admin', 'admin', 'regional_admin')));

DROP POLICY IF EXISTS "Gestion actualites par admin" ON public.platform_news;
CREATE POLICY "Gestion actualites par admin"
  ON public.platform_news FOR ALL
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('super_admin', 'admin', 'regional_admin')));

-- 4. TABLE : platform_analytics (Sections 11 & 12 — Statistiques d'audience & clics)
CREATE TABLE IF NOT EXISTS public.platform_analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visitor_id TEXT NOT NULL,
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('page_view', 'button_click', 'signup', 'follow', 'unfollow', 'review_submit', 'marche_open', 'partner_portal_open')),
  event_target TEXT,
  page_path TEXT DEFAULT '/',
  device_type TEXT DEFAULT 'mobile',
  city TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_analytics_event_date ON public.platform_analytics(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_analytics_visitor ON public.platform_analytics(visitor_id);

ALTER TABLE public.platform_analytics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Insertion publique analytics" ON public.platform_analytics;
CREATE POLICY "Insertion publique analytics"
  ON public.platform_analytics FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS "Lecture analytics audience" ON public.platform_analytics;
CREATE POLICY "Lecture analytics audience"
  ON public.platform_analytics FOR SELECT
  USING (true);
