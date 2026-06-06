
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
    2, '244p', _phone
  );
  insert into public.user_roles (user_id, role) values (new.id, 'user');
  return new;
end;
$function$;
