-- ============================================================
-- GiinMeet Superadmin portal — run ONCE in the Supabase SQL Editor
-- (https://supabase.com/dashboard/project/umeptngfntryekzxifvq/sql)
-- Idempotent: safe to re-run. Run AFTER giinmeet_plan_tier.sql.
--
-- What this sets up:
--   1. profiles.is_suspended / suspended_at / suspended_reason
--      (account suspension, enforced by the token route + Auth ban)
--   2. system_settings — the key/value store the Superadmin portal
--      configures (guest chat, tier limits, durations, defaults,
--      announcement banner). Public read, service-role write only.
--   3. superadmin_audit_log — every superadmin action, written
--      server-side by the /api/superadmin/* routes. No public access.
--   4. public.is_superadmin() — the DB-side role check RLS policies
--      use, so the database itself enforces the superadmin boundary.
--   5. Guest-chat gate: public.guest_chat_enabled() + a messages
--      INSERT policy that only lets anonymous guests send when the
--      portal flag is ON. Default OFF — guests can read chat but
--      cannot send, exactly as today.
--   6. Seeds nimdaukus@gmail.com as THE superadmin (the only grant
--      path) and stops new sign-ups auto-granting the role.
--   7. Moves the workspace_brand write policy from the hardcoded
--      superadmin email to the DB role (same source of truth).
-- ============================================================

-- 1. Suspension columns -------------------------------------------
alter table public.profiles
  add column if not exists is_suspended boolean not null default false;
alter table public.profiles
  add column if not exists suspended_at timestamptz;
alter table public.profiles
  add column if not exists suspended_reason text;

-- 2. System settings ----------------------------------------------
create table if not exists public.system_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
alter table public.system_settings enable row level security;

-- The meeting room reads guests_can_chat + the banner, and the app
-- reads the workspace defaults — all public, none secret. Writes go
-- through the service-role server routes only (no public write policy).
drop policy if exists "Public read system settings" on public.system_settings;
create policy "Public read system settings"
  on public.system_settings for select using (true);

-- Defaults. tier_limits / tier_max_duration_minutes mirror the code
-- constants in src/utils/tiers.ts — the portal edits these rows and
-- the token route enforces the stored values. guests_can_chat is OFF
-- until the superadmin turns it on (today's behaviour preserved).
insert into public.system_settings (key, value) values
  ('guests_can_chat', '{"enabled": false}'::jsonb),
  ('tier_limits', '{"free": 50, "pro": 100, "enterprise": 250}'::jsonb),
  ('tier_max_duration_minutes', '{"free": 40, "pro": 1440, "enterprise": 1440}'::jsonb),
  ('default_accent', '{"color": "#3B82F6"}'::jsonb),
  ('default_theme', '{"ui_style": "glassmorphism", "glass_opacity": "frosted"}'::jsonb),
  ('default_font', '{"heading": "Outfit", "body": "Inter"}'::jsonb),
  ('announcement_banner', '{"enabled": false, "message": ""}'::jsonb)
on conflict (key) do nothing;

-- 3. Superadmin audit log -----------------------------------------
create table if not exists public.superadmin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  actor_email text,
  action text not null,
  target_type text,
  target_id text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.superadmin_audit_log enable row level security;
-- No public policy at all: the portal reads this table only through
-- the service-role server route, so anonymous/authenticated clients
-- cannot read or write it directly.

-- 4. DB-side superadmin check + policies --------------------------
create or replace function public.is_superadmin()
returns boolean
language sql
stable
security definer
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and is_superadmin = true
  );
$$;

-- Defense in depth: even a client call (not just the server routes)
-- can only be made by a superadmin. The portal itself always goes
-- through the service-role routes; these policies close the door for
-- any future client code path.
drop policy if exists "Superadmins can update any profile" on public.profiles;
create policy "Superadmins can update any profile"
  on public.profiles for update using (public.is_superadmin());

drop policy if exists "Superadmins can update any meeting" on public.meetings;
create policy "Superadmins can update any meeting"
  on public.meetings for update using (public.is_superadmin());

-- 5. Guest-chat gate ------------------------------------------------
-- Reads the portal flag. The messages INSERT policy below only lets
-- an anonymous guest send when the flag is ON; signed-in users are
-- unaffected (their existing authenticated policy still applies).
create or replace function public.guest_chat_enabled()
returns boolean
language sql
stable
as $$
  select coalesce(
    (select (value ->> 'enabled')::boolean
     from public.system_settings where key = 'guests_can_chat'),
    false
  );
$$;

drop policy if exists "Guests may send chat when enabled" on public.messages;
create policy "Guests may send chat when enabled"
  on public.messages for insert
  with check (
    auth.role() = 'anon'
    and public.guest_chat_enabled()
    and user_id is null
  );

-- 6. Seed THE superadmin ------------------------------------------
-- nimdaukus@gmail.com is the superadmin of this system. This UPDATE
-- is the only grant path — nothing in the app auto-grants the role.
update public.profiles
set is_superadmin = true
where email = 'nimdaukus@gmail.com';

-- New sign-ups never auto-grant superadmin. (The old trigger set the
-- flag by email; the seed above replaces it.)
create or replace function public.handle_new_user()
returns trigger as $$
declare
  parsed_domain text;
  parsed_workspace text;
  full_name text;
  phone_num text;
begin
  if new.email is not null and new.email like '%@%' then
    parsed_domain := split_part(new.email, '@', 2);
  else
    parsed_domain := 'personal';
  end if;

  if parsed_domain = 'gmail.com' or parsed_domain = 'yahoo.com' or parsed_domain = 'hotmail.com' or parsed_domain = 'outlook.com' or parsed_domain = 'icloud.com' or parsed_domain = 'personal' then
    parsed_workspace := coalesce(new.raw_user_meta_data->>'workspace_name', 'Personal Workspace');
  else
    parsed_workspace := coalesce(new.raw_user_meta_data->>'workspace_name', initcap(split_part(parsed_domain, '.', 1)) || ' Enterprise Workspace');
  end if;

  full_name := coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1), 'Phone User');
  phone_num := coalesce(new.phone, new.raw_user_meta_data->>'phone');

  insert into public.profiles (id, name, email, workspace_name, domain, phone, is_premium, is_superadmin)
  values (
    new.id,
    full_name,
    new.email,
    parsed_workspace,
    parsed_domain,
    phone_num,
    coalesce((new.raw_user_meta_data->>'is_premium')::boolean, false),
    false
  )
  on conflict (id) do update
  set name = excluded.name,
      email = excluded.email,
      workspace_name = excluded.workspace_name,
      domain = excluded.domain,
      phone = excluded.phone;

  return new;
end;
$$ language plpgsql security definer;

-- 7. Brand writes move to the DB role ------------------------------
-- giinmeet_phase3_brand.sql locked workspace_brand writes to the
-- superadmin EMAIL; that policy is replaced here so the role flag is
-- the single source of truth everywhere. Guarded: a no-op when the
-- brand table does not exist yet (brand SQL not run).
do $$
begin
  if to_regclass('public.workspace_brand') is not null then
    drop policy if exists "Workspace brand written by the superadmin" on public.workspace_brand;
    create policy "Workspace brand written by the superadmin"
      on public.workspace_brand for all
      using (public.is_superadmin())
      with check (public.is_superadmin());
  end if;
end $$;
