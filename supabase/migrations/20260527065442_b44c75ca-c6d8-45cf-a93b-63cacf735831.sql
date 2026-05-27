
-- Profiles: thumbnail upload permission
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS can_upload_thumbnails boolean NOT NULL DEFAULT false;

-- Packages: whether buying this grants thumbnail upload
ALTER TABLE public.credit_packages ADD COLUMN IF NOT EXISTS allow_thumbnail boolean NOT NULL DEFAULT false;

-- User thumbnails table
CREATE TABLE IF NOT EXISTS public.user_thumbnails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  image_url text NOT NULL,
  accent_color text NOT NULL DEFAULT '#34d399',
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_thumbnails TO authenticated;
GRANT ALL ON public.user_thumbnails TO service_role;

ALTER TABLE public.user_thumbnails ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own thumbnails" ON public.user_thumbnails
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own thumbnails" ON public.user_thumbnails
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own thumbnails" ON public.user_thumbnails
  FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Admins manage thumbnails" ON public.user_thumbnails
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Private storage bucket for thumbnails
INSERT INTO storage.buckets (id, name, public) VALUES ('user-thumbnails', 'user-thumbnails', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Users view own thumbnail files" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'user-thumbnails' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users upload own thumbnail files" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'user-thumbnails' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Users delete own thumbnail files" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'user-thumbnails' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Admin: grant/revoke thumbnail upload access
CREATE OR REPLACE FUNCTION public.admin_set_thumbnail_access(_user_id uuid, _allow boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Not admin'; END IF;
  UPDATE public.profiles SET can_upload_thumbnails = _allow WHERE id = _user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'User not found'; END IF;
  INSERT INTO public.notifications (user_id, title, message)
    VALUES (_user_id, 'Thumbnail Access',
      CASE WHEN _allow THEN 'You can now upload custom thumbnails!' ELSE 'Your thumbnail upload access was revoked.' END);
END; $$;

-- Update approve_payment to auto-grant thumbnail access if package allows
CREATE OR REPLACE FUNCTION public.approve_payment(_request_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _r record; _pkg record;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Not admin'; END IF;
  SELECT * INTO _r FROM public.payment_requests WHERE id = _request_id FOR UPDATE;
  IF _r IS NULL THEN RAISE EXCEPTION 'Not found'; END IF;
  IF _r.status <> 'pending' THEN RAISE EXCEPTION 'Already processed'; END IF;

  SELECT allow_thumbnail INTO _pkg FROM public.credit_packages WHERE id = _r.package_id;

  UPDATE public.profiles
    SET credits = credits + _r.credits,
        max_resolution = CASE WHEN public.resolution_rank(_r.max_resolution) > public.resolution_rank(max_resolution)
          THEN _r.max_resolution ELSE max_resolution END,
        can_upload_thumbnails = can_upload_thumbnails OR COALESCE(_pkg.allow_thumbnail, false)
    WHERE id = _r.user_id;

  UPDATE public.payment_requests SET status='approved', reviewed_at=now() WHERE id = _request_id;
  INSERT INTO public.credit_ledger (user_id, delta, reason, admin_id)
    VALUES (_r.user_id, _r.credits, 'payment_approved:'||_r.package_name, auth.uid());
  INSERT INTO public.notifications (user_id, title, message)
    VALUES (_r.user_id, 'Payment Approved',
      _r.credits||' credits added. Max quality: '||_r.max_resolution ||
      CASE WHEN COALESCE(_pkg.allow_thumbnail, false) THEN ' · Thumbnail upload unlocked!' ELSE '' END);
END; $$;
