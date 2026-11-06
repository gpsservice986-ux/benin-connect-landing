-- =================================================================================
-- REFONTE ET MODERNISATION DE BÉNIN CONNECT (https://benin-connect.com)
-- Script SQL Additif & Non-Destructif (Sécurité RLS incluse)
-- Réutilise les tables existantes : profiles, vendors, products, categories,
-- reviews, notifications, et les tables jds_* (JDS PARTENAIRES).
-- =================================================================================

-- 1. TABLE : platform_followers (Section 10 — Abonnés Bénin Connect sans création de compte)
CREATE TABLE IF NOT EXISTS public.platform_followers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  city TEXT DEFAULT 'Parakou',
  receive_news BOOLEAN DEFAULT true,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.platform_followers ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE public.platform_followers ADD COLUMN IF NOT EXISTS receive_news BOOLEAN DEFAULT true;
ALTER TABLE public.platform_followers ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_platform_followers_active ON public.platform_followers(is_active);
CREATE INDEX IF NOT EXISTS idx_platform_followers_phone ON public.platform_followers(phone);
CREATE INDEX IF NOT EXISTS idx_platform_followers_created ON public.platform_followers(created_at DESC);

ALTER TABLE public.platform_followers ENABLE ROW LEVEL SECURITY;

-- Seul le Super Admin peut consulter la liste des abonnés (noms, téléphones, e-mails)
DROP POLICY IF EXISTS "Lecture publique du nombre d'abonnes" ON public.platform_followers;
DROP POLICY IF EXISTS "Lecture abonnes reservee au Super Admin" ON public.platform_followers;
CREATE POLICY "Lecture abonnes reservee au Super Admin"
  ON public.platform_followers FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('super_admin', 'admin')
    )
  );

-- Inscription libre par formulaire simple (sans création de compte)
DROP POLICY IF EXISTS "Insertion abonnement utilisateur" ON public.platform_followers;
DROP POLICY IF EXISTS "Insertion publique abonnement Benin Connect" ON public.platform_followers;
CREATE POLICY "Insertion publique abonnement Benin Connect"
  ON public.platform_followers FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS "Modification abonnement utilisateur" ON public.platform_followers;
CREATE POLICY "Modification abonnement utilisateur"
  ON public.platform_followers FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('super_admin', 'admin')
    )
  );

DROP POLICY IF EXISTS "Suppression abonnement utilisateur" ON public.platform_followers;
CREATE POLICY "Suppression abonnement utilisateur"
  ON public.platform_followers FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('super_admin', 'admin')
    )
  );

-- Fonction RPC sécurisée pour afficher uniquement le compteur public d'abonnés actifs
-- sans jamais exposer la liste des noms/numéros aux visiteurs publics
CREATE OR REPLACE FUNCTION public.get_platform_followers_count()
RETURNS INTEGER
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(COUNT(*)::INTEGER, 0)
  FROM public.platform_followers
  WHERE is_active = true;
$$;

GRANT EXECUTE ON FUNCTION public.get_platform_followers_count() TO anon, authenticated;

-- Fonction RPC sécurisée pour permettre le désabonnement facile par numéro de téléphone ou e-mail
CREATE OR REPLACE FUNCTION public.unsubscribe_platform_follower(p_contact TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clean TEXT := trim(COALESCE(p_contact, ''));
BEGIN
  IF v_clean = '' THEN
    RETURN false;
  END IF;
  UPDATE public.platform_followers
  SET is_active = false, receive_news = false, updated_at = now()
  WHERE lower(trim(COALESCE(email, ''))) = lower(v_clean)
     OR regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g') = regexp_replace(v_clean, '[^0-9]', '', 'g');
  RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION public.unsubscribe_platform_follower(TEXT) TO anon, authenticated;

-- 2. TABLE : platform_reviews (Section 10 — Avis Bénin Connect & Marché d'Aujourd'hui avec validation Super Admin)
CREATE TABLE IF NOT EXISTS public.platform_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  author_name TEXT NOT NULL,
  author_avatar TEXT,
  author_role TEXT DEFAULT 'Membre vérifié',
  author_city TEXT DEFAULT 'Bénin',
  target_type TEXT NOT NULL CHECK (target_type IN ('benin_connect', 'marche_aujourdhui', 'mobile_app')),
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('approved', 'pending', 'reported', 'rejected')),
  report_count INTEGER DEFAULT 0,
  report_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.platform_reviews ADD COLUMN IF NOT EXISTS author_avatar TEXT;
ALTER TABLE public.platform_reviews ALTER COLUMN status SET DEFAULT 'pending';

CREATE INDEX IF NOT EXISTS idx_platform_reviews_target_status ON public.platform_reviews(target_type, status, created_at DESC);

ALTER TABLE public.platform_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Lecture publique des avis valides" ON public.platform_reviews;
CREATE POLICY "Lecture publique des avis valides"
  ON public.platform_reviews FOR SELECT
  USING (
    status = 'approved'
    OR auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('super_admin', 'admin', 'regional_admin')
    )
  );

DROP POLICY IF EXISTS "Insertion avis par utilisateur connecte" ON public.platform_reviews;
CREATE POLICY "Insertion avis par utilisateur connecte"
  ON public.platform_reviews FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Mise a jour avis par Super Admin" ON public.platform_reviews;
DROP POLICY IF EXISTS "Mise a jour avis ou signalement" ON public.platform_reviews;
CREATE POLICY "Mise a jour avis par Super Admin"
  ON public.platform_reviews FOR UPDATE
  USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('super_admin', 'admin', 'regional_admin')
    )
  );

DROP POLICY IF EXISTS "Suppression avis par admin" ON public.platform_reviews;
CREATE POLICY "Suppression avis par admin"
  ON public.platform_reviews FOR DELETE
  USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('super_admin', 'admin')
    )
  );

-- 3. TABLE : platform_news (Actualités Bénin Connect)
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
  USING (
    is_published = true
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('super_admin', 'admin', 'regional_admin')
    )
  );

DROP POLICY IF EXISTS "Gestion actualites par admin" ON public.platform_news;
CREATE POLICY "Gestion actualites par admin"
  ON public.platform_news FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('super_admin', 'admin', 'regional_admin')
    )
  );

-- 4. TABLE : platform_analytics (Statistiques d'audience & clics)
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
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role IN ('super_admin', 'admin', 'regional_admin')
    )
  );
