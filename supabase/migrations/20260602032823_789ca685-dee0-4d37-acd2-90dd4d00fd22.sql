
-- 1. approve_payment: use package values, not user-supplied
CREATE OR REPLACE FUNCTION public.approve_payment(_request_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _r record; _pkg record;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'Not admin'; END IF;
  SELECT * INTO _r FROM public.payment_requests WHERE id = _request_id FOR UPDATE;
  IF _r IS NULL THEN RAISE EXCEPTION 'Not found'; END IF;
  IF _r.status <> 'pending' THEN RAISE EXCEPTION 'Already processed'; END IF;

  SELECT credits, max_resolution, allow_thumbnail INTO _pkg
    FROM public.credit_packages WHERE id = _r.package_id;
  IF _pkg IS NULL THEN RAISE EXCEPTION 'Package not found'; END IF;

  UPDATE public.profiles
    SET credits = credits + _pkg.credits,
        max_resolution = CASE WHEN public.resolution_rank(_pkg.max_resolution) > public.resolution_rank(max_resolution)
          THEN _pkg.max_resolution ELSE max_resolution END,
        can_upload_thumbnails = can_upload_thumbnails OR COALESCE(_pkg.allow_thumbnail, false)
    WHERE id = _r.user_id;

  -- Sync record with the trusted package values so admin UI/history is accurate
  UPDATE public.payment_requests
    SET status='approved', reviewed_at=now(),
        credits = _pkg.credits, max_resolution = _pkg.max_resolution
    WHERE id = _request_id;

  INSERT INTO public.credit_ledger (user_id, delta, reason, admin_id)
    VALUES (_r.user_id, _pkg.credits, 'payment_approved:'||_r.package_name, auth.uid());
  INSERT INTO public.notifications (user_id, title, message)
    VALUES (_r.user_id, 'Payment Approved',
      _pkg.credits||' credits added. Max quality: '||_pkg.max_resolution ||
      CASE WHEN COALESCE(_pkg.allow_thumbnail, false) THEN ' · Thumbnail upload unlocked!' ELSE '' END);
END; $function$;

-- 2. resolution_rank: fix mutable search_path
CREATE OR REPLACE FUNCTION public.resolution_rank(_r resolution_tier)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select case _r
    when '244p' then 1 when '480p' then 2 when '720p' then 3
    when '1080p' then 4 when '2k' then 5 when '4k' then 6
  end
$function$;

-- 3. is_banned helper
CREATE OR REPLACE FUNCTION public.is_banned(_uid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE((SELECT banned FROM public.profiles WHERE id = _uid), false)
$function$;

-- 4. Block banned users via restrictive policies
DROP POLICY IF EXISTS "Block banned users" ON public.point_tables;
CREATE POLICY "Block banned users" ON public.point_tables
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT public.is_banned(auth.uid()))
  WITH CHECK (NOT public.is_banned(auth.uid()));

DROP POLICY IF EXISTS "Block banned users" ON public.downloads;
CREATE POLICY "Block banned users" ON public.downloads
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT public.is_banned(auth.uid()))
  WITH CHECK (NOT public.is_banned(auth.uid()));

DROP POLICY IF EXISTS "Block banned users" ON public.payment_requests;
CREATE POLICY "Block banned users" ON public.payment_requests
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT public.is_banned(auth.uid()))
  WITH CHECK (NOT public.is_banned(auth.uid()));

DROP POLICY IF EXISTS "Block banned users" ON public.user_thumbnails;
CREATE POLICY "Block banned users" ON public.user_thumbnails
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT public.is_banned(auth.uid()))
  WITH CHECK (NOT public.is_banned(auth.uid()));

-- 5. profiles: trigger to block non-admin changes to protected fields
CREATE OR REPLACE FUNCTION public.protect_profile_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF public.has_role(auth.uid(), 'admin') THEN
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.email IS DISTINCT FROM OLD.email
     OR NEW.credits IS DISTINCT FROM OLD.credits
     OR NEW.banned IS DISTINCT FROM OLD.banned
     OR NEW.can_upload_thumbnails IS DISTINCT FROM OLD.can_upload_thumbnails
     OR NEW.max_resolution IS DISTINCT FROM OLD.max_resolution
  THEN
    RAISE EXCEPTION 'Not allowed to modify protected profile fields';
  END IF;
  RETURN NEW;
END; $function$;

DROP TRIGGER IF EXISTS protect_profile_fields_trg ON public.profiles;
CREATE TRIGGER protect_profile_fields_trg
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_fields();

-- 6. user_roles: restrictive policy so only admins can write
DROP POLICY IF EXISTS "Only admins write roles" ON public.user_roles;
CREATE POLICY "Only admins write roles" ON public.user_roles
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'))
  WITH CHECK (has_role(auth.uid(),'admin'));
-- Re-allow reads for own roles (restrictive blocks them otherwise)
DROP POLICY IF EXISTS "Only admins write roles" ON public.user_roles;
CREATE POLICY "Block non-admin role writes" ON public.user_roles
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(),'admin'));
CREATE POLICY "Block non-admin role updates" ON public.user_roles
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (has_role(auth.uid(),'admin'))
  WITH CHECK (has_role(auth.uid(),'admin'));
CREATE POLICY "Block non-admin role deletes" ON public.user_roles
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (has_role(auth.uid(),'admin'));

-- 7. app_settings: restrict to authenticated
DROP POLICY IF EXISTS "Anyone reads settings" ON public.app_settings;
CREATE POLICY "Authenticated reads settings" ON public.app_settings
  FOR SELECT TO authenticated USING (true);

-- 8. Storage: tables bucket — scope by user folder
DROP POLICY IF EXISTS "Users write tables" ON storage.objects;
DROP POLICY IF EXISTS "Users update own tables" ON storage.objects;
DROP POLICY IF EXISTS "Users delete own tables" ON storage.objects;
DROP POLICY IF EXISTS "Read tables by name" ON storage.objects;

CREATE POLICY "Users read own tables" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'tables' AND (auth.uid())::text = (storage.foldername(name))[1]);
CREATE POLICY "Users write own tables" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'tables' AND (auth.uid())::text = (storage.foldername(name))[1]);
CREATE POLICY "Users update own tables" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'tables' AND (auth.uid())::text = (storage.foldername(name))[1]);
CREATE POLICY "Users delete own tables" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'tables' AND (auth.uid())::text = (storage.foldername(name))[1]);

-- Make 'tables' private (signed URLs only)
UPDATE storage.buckets SET public = false WHERE id = 'tables';

-- 9. Restrict listing on public buckets: limit SELECT policy to actual file fetch
-- For 'templates' and 'site' buckets, public read is intentional for asset access.
-- Replace broad SELECT with one that still allows getPublicUrl but limits LIST via name filter.
-- Public buckets use anon role for SELECT; keep but no change needed for getPublicUrl (no RLS check on public URL).
-- However, to satisfy listing concern, restrict storage.objects SELECT to authenticated only;
-- public URLs continue to work because they go through the public CDN path.
DROP POLICY IF EXISTS "Read templates by name" ON storage.objects;
DROP POLICY IF EXISTS "Read site by name" ON storage.objects;

-- 10. Tighten function execute permissions
REVOKE EXECUTE ON FUNCTION public.admin_adjust_credits(uuid, integer, text) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.admin_set_thumbnail_access(uuid, boolean) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.admin_set_user_quality(uuid, public.resolution_tier) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.admin_stats() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.approve_payment(uuid) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.reject_payment(uuid, text) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.spend_credit_for_download(uuid, public.resolution_tier) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.is_banned(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated, public;

-- Grant back what's needed
GRANT EXECUTE ON FUNCTION public.admin_adjust_credits(uuid, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_thumbnail_access(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_user_quality(uuid, public.resolution_tier) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_payment(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_payment(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.spend_credit_for_download(uuid, public.resolution_tier) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_banned(uuid) TO authenticated;
