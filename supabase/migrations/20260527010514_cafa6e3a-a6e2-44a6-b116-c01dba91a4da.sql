-- ============ ENUMS ============
create type public.app_role as enum ('admin', 'user');
create type public.payment_status as enum ('pending', 'approved', 'rejected');
create type public.payment_method as enum ('bkash', 'nagad');

-- ============ PROFILES ============
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text,
  email text,
  avatar_url text,
  credits integer not null default 0,
  banned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create policy "Profiles are viewable by owner" on public.profiles
  for select using (auth.uid() = id);
create policy "Users update own profile" on public.profiles
  for update using (auth.uid() = id);

-- ============ ROLES ============
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);
alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role app_role)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.user_roles where user_id=_user_id and role=_role)
$$;

create policy "Users view own roles" on public.user_roles
  for select using (auth.uid() = user_id);
create policy "Admins view all roles" on public.user_roles
  for select using (public.has_role(auth.uid(),'admin'));
create policy "Admins manage roles" on public.user_roles
  for all using (public.has_role(auth.uid(),'admin'))
  with check (public.has_role(auth.uid(),'admin'));

create policy "Admins view all profiles" on public.profiles
  for select using (public.has_role(auth.uid(),'admin'));
create policy "Admins update all profiles" on public.profiles
  for update using (public.has_role(auth.uid(),'admin'));

-- ============ PROFILE TRIGGER ============
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, username, credits, max_resolution)
  values (
    new.id, new.email,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email,'@',1)),
    1, '244p'
  );
  insert into public.user_roles (user_id, role) values (new.id, 'user');
  return new;
end;
$$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end; $$;

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ============ TEMPLATES ============
create table public.templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  image_url text not null,
  coordinates jsonb not null default '{}'::jsonb,
  premium boolean not null default false,
  active boolean not null default true,
  accent_color text not null default '#34d399',
  created_at timestamptz not null default now()
);
alter table public.templates enable row level security;
create policy "Anyone reads active templates" on public.templates
  for select using (active = true or public.has_role(auth.uid(),'admin'));
create policy "Admins manage templates" on public.templates
  for all using (public.has_role(auth.uid(),'admin'))
  with check (public.has_role(auth.uid(),'admin'));

-- ============ POINT TABLES ============
create table public.point_tables (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tournament_name text not null,
  template_id uuid references public.templates(id) on delete set null,
  data jsonb not null default '{}'::jsonb,
  image_url text,
  created_at timestamptz not null default now()
);
alter table public.point_tables enable row level security;
create policy "Users view own tables" on public.point_tables
  for select using (auth.uid() = user_id);
create policy "Users insert own tables" on public.point_tables
  for insert with check (auth.uid() = user_id);
create policy "Users update own tables" on public.point_tables
  for update using (auth.uid() = user_id);
create policy "Users delete own tables" on public.point_tables
  for delete using (auth.uid() = user_id);
create policy "Admins manage all tables" on public.point_tables
  for all using (public.has_role(auth.uid(),'admin'));

-- ============ CREDIT PACKAGES ============
create table public.credit_packages (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  price numeric(10,2) not null,
  credits integer not null,
  features jsonb not null default '[]'::jsonb,
  popular boolean not null default false,
  active boolean not null default true,
  sort_order integer not null default 0,
  max_resolution text not null default '244p',
  created_at timestamptz not null default now()
);
alter table public.credit_packages enable row level security;
create policy "Anyone reads active packages" on public.credit_packages
  for select using (active = true or public.has_role(auth.uid(),'admin'));
create policy "Admins manage packages" on public.credit_packages
  for all using (public.has_role(auth.uid(),'admin'));

-- ============ Resolution tier ============
create type public.resolution_tier as enum ('244p','480p','720p','1080p','2k','4k');
create or replace function public.resolution_rank(_r public.resolution_tier)
returns integer language sql immutable as $$
  select case _r
    when '244p' then 1 when '480p' then 2 when '720p' then 3
    when '1080p' then 4 when '2k' then 5 when '4k' then 6
  end
$$;

alter table public.profiles add column max_resolution public.resolution_tier not null default '244p';
alter table public.credit_packages drop column max_resolution;
alter table public.credit_packages add column max_resolution public.resolution_tier not null default '244p';

-- ============ PAYMENT REQUESTS ============
create table public.payment_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  package_id uuid references public.credit_packages(id) on delete set null,
  package_name text not null,
  amount numeric(10,2) not null,
  credits integer not null,
  payment_method payment_method not null,
  sender_number text not null,
  transaction_id text not null,
  status payment_status not null default 'pending',
  reject_reason text,
  max_resolution public.resolution_tier not null default '244p',
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);
alter table public.payment_requests enable row level security;
create policy "Users view own payments" on public.payment_requests
  for select using (auth.uid() = user_id);
create policy "Users create payments" on public.payment_requests
  for insert with check (auth.uid() = user_id);
create policy "Admins manage payments" on public.payment_requests
  for all using (public.has_role(auth.uid(),'admin'));

-- ============ DOWNLOADS ============
create table public.downloads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  table_id uuid references public.point_tables(id) on delete set null,
  credits_used integer not null default 1,
  resolution public.resolution_tier not null default '244p',
  created_at timestamptz not null default now()
);
alter table public.downloads enable row level security;
create policy "Users view own downloads" on public.downloads
  for select using (auth.uid() = user_id);
create policy "Users insert own downloads" on public.downloads
  for insert with check (auth.uid() = user_id);
create policy "Admins view all downloads" on public.downloads
  for select using (public.has_role(auth.uid(),'admin'));

-- ============ NOTIFICATIONS ============
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  title text not null,
  message text not null,
  read boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.notifications enable row level security;
create policy "Users view own/global notifications" on public.notifications
  for select using (user_id is null or user_id = auth.uid());
create policy "Users update own notifications" on public.notifications
  for update using (user_id = auth.uid());
create policy "Admins manage notifications" on public.notifications
  for all using (public.has_role(auth.uid(),'admin'));

-- ============ CREDIT LEDGER ============
create table public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  delta integer not null,
  reason text not null,
  admin_id uuid,
  created_at timestamptz not null default now()
);
alter table public.credit_ledger enable row level security;
create policy "Users view own ledger" on public.credit_ledger
  for select using (auth.uid() = user_id);
create policy "Admins manage ledger" on public.credit_ledger
  for all using (public.has_role(auth.uid(),'admin'));

-- ============ SETTINGS ============
create table public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
create policy "Anyone reads settings" on public.app_settings for select using (true);
create policy "Admins manage settings" on public.app_settings
  for all using (public.has_role(auth.uid(),'admin'));

insert into public.app_settings (key, value) values
  ('site', '{"name":"Point Arena","logo_url":null,"payment_number":"01957941250","maintenance":false}'::jsonb)
  on conflict (key) do nothing;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============ STORAGE BUCKETS ============
insert into storage.buckets (id, name, public) values
  ('templates','templates', true),
  ('site','site', true),
  ('tables','tables', true)
  on conflict (id) do nothing;

create policy "Read templates by name" on storage.objects for select using (bucket_id='templates');
create policy "Read site by name" on storage.objects for select using (bucket_id='site');
create policy "Read tables by name" on storage.objects for select using (bucket_id='tables');
create policy "Admins write templates" on storage.objects for insert with check (bucket_id='templates' and public.has_role(auth.uid(),'admin'));
create policy "Admins update templates" on storage.objects for update using (bucket_id='templates' and public.has_role(auth.uid(),'admin'));
create policy "Admins delete templates" on storage.objects for delete using (bucket_id='templates' and public.has_role(auth.uid(),'admin'));
create policy "Admins write site" on storage.objects for insert with check (bucket_id='site' and public.has_role(auth.uid(),'admin'));
create policy "Admins update site" on storage.objects for update using (bucket_id='site' and public.has_role(auth.uid(),'admin'));
create policy "Admins delete site" on storage.objects for delete using (bucket_id='site' and public.has_role(auth.uid(),'admin'));
create policy "Users write tables" on storage.objects for insert with check (bucket_id='tables' and auth.uid() is not null);
create policy "Users update own tables" on storage.objects for update using (bucket_id='tables' and auth.uid() is not null);
create policy "Users delete own tables" on storage.objects for delete using (bucket_id='tables' and auth.uid() is not null);

-- ============ SEED PACKAGES ============
insert into public.credit_packages (title, price, credits, features, popular, sort_order, max_resolution) values
  ('Starter', 100, 20, '["20 HD Downloads","All Free Templates","Basic Support"]'::jsonb, false, 1, '480p'),
  ('Pro', 250, 60, '["60 HD Downloads","All Templates","Priority Support","AI Templates"]'::jsonb, true, 2, '720p'),
  ('Team', 500, 150, '["150 HD Downloads","All Premium Templates","24/7 Support","Watermark Free"]'::jsonb, false, 3, '1080p'),
  ('Premium', 1000, 400, '["400 HD Downloads","Everything in Team","Early Access","Custom Templates"]'::jsonb, false, 4, '4k');

revoke execute on function public.has_role(uuid, public.app_role) from public, anon;
grant execute on function public.has_role(uuid, public.app_role) to authenticated;

-- ============ RPC FUNCTIONS ============
create or replace function public.approve_payment(_request_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare _r record;
begin
  if not public.has_role(auth.uid(),'admin') then raise exception 'Not admin'; end if;
  select * into _r from public.payment_requests where id=_request_id for update;
  if _r is null then raise exception 'Not found'; end if;
  if _r.status <> 'pending' then raise exception 'Already processed'; end if;
  update public.profiles
    set credits = credits + _r.credits,
        max_resolution = case when public.resolution_rank(_r.max_resolution) > public.resolution_rank(max_resolution)
          then _r.max_resolution else max_resolution end
    where id = _r.user_id;
  update public.payment_requests set status='approved', reviewed_at=now() where id=_request_id;
  insert into public.credit_ledger (user_id, delta, reason, admin_id)
    values (_r.user_id, _r.credits, 'payment_approved:'||_r.package_name, auth.uid());
  insert into public.notifications (user_id, title, message)
    values (_r.user_id, 'Payment Approved', _r.credits||' credits added. Max quality: '||_r.max_resolution);
end; $$;
grant execute on function public.approve_payment(uuid) to authenticated;

create or replace function public.reject_payment(_request_id uuid, _reason text)
returns void language plpgsql security definer set search_path = public as $$
declare _r record;
begin
  if not public.has_role(auth.uid(),'admin') then raise exception 'Not admin'; end if;
  select * into _r from public.payment_requests where id=_request_id for update;
  if _r is null then raise exception 'Not found'; end if;
  if _r.status <> 'pending' then raise exception 'Already processed'; end if;
  update public.payment_requests set status='rejected', reject_reason=_reason, reviewed_at=now() where id=_request_id;
  insert into public.notifications (user_id, title, message)
    values (_r.user_id, 'Payment Rejected', coalesce(_reason,'Your payment was rejected.'));
end; $$;
grant execute on function public.reject_payment(uuid, text) to authenticated;

create or replace function public.admin_adjust_credits(_user_id uuid, _delta integer, _reason text)
returns integer language plpgsql security definer set search_path = public as $$
declare _new integer;
begin
  if not public.has_role(auth.uid(),'admin') then raise exception 'Not admin'; end if;
  update public.profiles set credits = greatest(0, credits + _delta) where id = _user_id returning credits into _new;
  if _new is null then raise exception 'User not found'; end if;
  insert into public.credit_ledger (user_id, delta, reason, admin_id) values (_user_id, _delta, _reason, auth.uid());
  return _new;
end; $$;
grant execute on function public.admin_adjust_credits(uuid, integer, text) to authenticated;

create or replace function public.admin_stats()
returns jsonb language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  if not public.has_role(auth.uid(),'admin') then raise exception 'Not admin'; end if;
  select jsonb_build_object(
    'users', (select count(*) from public.profiles),
    'downloads', (select count(*) from public.downloads),
    'revenue', coalesce((select sum(amount) from public.payment_requests where status='approved'),0),
    'templates', (select count(*) from public.templates),
    'credits_sold', coalesce((select sum(credits) from public.payment_requests where status='approved'),0),
    'pending_payments', (select count(*) from public.payment_requests where status='pending'),
    'approved_payments', (select count(*) from public.payment_requests where status='approved'),
    'tables', (select count(*) from public.point_tables)
  ) into result;
  return result;
end; $$;
grant execute on function public.admin_stats() to authenticated;

create or replace function public.admin_set_user_quality(_user_id uuid, _quality public.resolution_tier)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role(auth.uid(),'admin') then raise exception 'Not admin'; end if;
  update public.profiles set max_resolution = _quality where id = _user_id;
  insert into public.notifications (user_id, title, message)
    values (_user_id, 'Quality Updated', 'Your max quality is now '||_quality);
end; $$;
grant execute on function public.admin_set_user_quality(uuid, public.resolution_tier) to authenticated;

create or replace function public.spend_credit_for_download(_table_id uuid, _resolution public.resolution_tier)
returns integer language plpgsql security definer set search_path = public as $$
declare _uid uuid := auth.uid(); _new_credits integer; _max public.resolution_tier;
begin
  if _uid is null then raise exception 'Not authenticated'; end if;
  select max_resolution into _max from public.profiles where id = _uid;
  if public.resolution_rank(_resolution) > public.resolution_rank(_max) then
    raise exception 'RESOLUTION_LOCKED';
  end if;
  update public.profiles set credits = credits - 1 where id = _uid and credits > 0 returning credits into _new_credits;
  if _new_credits is null then raise exception 'INSUFFICIENT_CREDITS'; end if;
  insert into public.downloads (user_id, table_id, credits_used, resolution) values (_uid, _table_id, 1, _resolution);
  insert into public.credit_ledger (user_id, delta, reason) values (_uid, -1, 'download:'||_resolution);
  return _new_credits;
end; $$;
grant execute on function public.spend_credit_for_download(uuid, public.resolution_tier) to authenticated;

-- ============ GRANTS for PostgREST Data API ============
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.templates TO authenticated;
GRANT SELECT ON public.templates TO anon;
GRANT ALL ON public.templates TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.point_tables TO authenticated;
GRANT ALL ON public.point_tables TO service_role;
GRANT SELECT ON public.credit_packages TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.credit_packages TO authenticated;
GRANT ALL ON public.credit_packages TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_requests TO authenticated;
GRANT ALL ON public.payment_requests TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.downloads TO authenticated;
GRANT ALL ON public.downloads TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.credit_ledger TO authenticated;
GRANT ALL ON public.credit_ledger TO service_role;
GRANT SELECT ON public.app_settings TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.app_settings TO authenticated;
GRANT ALL ON public.app_settings TO service_role;