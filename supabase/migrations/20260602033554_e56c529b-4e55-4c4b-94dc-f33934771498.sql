-- Fix 1: Enforce can_upload_thumbnails server-side via RLS
DROP POLICY IF EXISTS "Users insert own thumbnails" ON public.user_thumbnails;
CREATE POLICY "Users insert own thumbnails" ON public.user_thumbnails
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND COALESCE((SELECT can_upload_thumbnails FROM public.profiles WHERE id = auth.uid()), false)
  );

-- Storage bucket: also enforce can_upload_thumbnails on upload
DROP POLICY IF EXISTS "Users upload own thumbnail files" ON storage.objects;
CREATE POLICY "Users upload own thumbnail files" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'user-thumbnails'
    AND auth.uid()::text = (storage.foldername(name))[1]
    AND COALESCE((SELECT can_upload_thumbnails FROM public.profiles WHERE id = auth.uid()), false)
  );

-- Fix 2: Revoke EXECUTE from anon/public on SECURITY DEFINER functions
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_banned(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_stats() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_set_user_quality(uuid, resolution_tier) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_adjust_credits(uuid, integer, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_set_thumbnail_access(uuid, boolean) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.approve_payment(uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reject_payment(uuid, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.spend_credit_for_download(uuid, resolution_tier) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.protect_profile_fields() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, PUBLIC;

GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_banned(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_user_quality(uuid, resolution_tier) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_adjust_credits(uuid, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_thumbnail_access(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_payment(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_payment(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.spend_credit_for_download(uuid, resolution_tier) TO authenticated;