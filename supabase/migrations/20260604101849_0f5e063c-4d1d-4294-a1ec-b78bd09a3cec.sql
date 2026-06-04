ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone text;
CREATE UNIQUE INDEX IF NOT EXISTS profiles_phone_unique ON public.profiles (phone) WHERE phone IS NOT NULL;

-- Update handle_new_user to capture phone from metadata
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare _phone text;
begin
  _phone := nullif(trim(new.raw_user_meta_data->>'phone'), '');
  if _phone is not null and exists (select 1 from public.profiles where phone = _phone) then
    raise exception 'PHONE_ALREADY_USED' using errcode = '23505';
  end if;
  insert into public.profiles (id, email, username, credits, max_resolution, phone)
  values (
    new.id, new.email,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email,'@',1)),
    1, '244p', _phone
  );
  insert into public.user_roles (user_id, role) values (new.id, 'user');
  return new;
end;
$function$;

-- Protect phone field from being changed by users (admins still allowed)
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
     OR (OLD.phone IS NOT NULL AND NEW.phone IS DISTINCT FROM OLD.phone)
  THEN
    RAISE EXCEPTION 'Not allowed to modify protected profile fields';
  END IF;
  RETURN NEW;
END; $function$;