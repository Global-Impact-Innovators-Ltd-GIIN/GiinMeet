-- =====================================================================
-- GiinMeet Phase 3 (Feature 3) — Team workspaces
-- (RUN IN SUPABASE SQL EDITOR, GIIN org project, the giinmeet project)
-- =====================================================================
-- RUN ORDER: deploy the Phase 3 Feature 3 code FIRST, then run this
-- file once. The new code probe-gates every teams read/write, so
-- before this runs the Teams view says honestly "team workspaces are
-- not set up yet" instead of crashing, and no meeting is ever
-- silently created outside its team. If this file ran first, the OLD
-- app would simply ignore the new tables (nothing in it reads them).
--
-- WHY:
--  1. A team is a shared space: members, its own meetings, and shared
--     settings. Until now GiinMeet only had per-user meetings
--     (meetings.user_id) and a per-user workspace NAME (profiles.
--     workspace_name) — no shared membership anywhere. The chat
--     groups / group_members tables are chat-only and are NOT reused:
--     a chat group has no admin, no settings, and no meetings.
--  2. meetings.team_id links a meeting to its team. The meeting engine
--     is unchanged (same LiveKit room, same waiting room / passcode
--     rules); the team only decides WHO may see and join it.
--  3. ENFORCEMENT LIVES SERVER-SIDE, not in the client:
--       * POST /api/livekit/token refuses a token for a team meeting
--         to anyone who is not a team member (guests have no account,
--         so they can never be members). The host is the one
--         exception — they own the meeting.
--       * POST /api/meetings/admit refuses to admit a non-member to a
--         team meeting, so a removed member sitting in the waiting
--         room cannot be let in afterwards.
--     The client-side list (Dashboard / Teams view) only SHOWS a
--     team's meetings to its members; that is display, not security.
--  4. RLS keeps membership honest at the database too: only a team
--     admin (or the team creator, who counts as admin) can add or
--     remove members, and a member can only remove THEMSELVES
--     (leave). Without this, anyone with the anon key could add
--     themselves to any team — the same self-promotion hole the
--     co-host SQL (giinmeet_cohost_moderator_roles.sql) closed for
--     meeting roles.
--
-- WHAT THIS CREATES:
--   * teams           — id, name, created_by, created_at
--   * team_members    — team_id, user_id, role ('admin' | 'member'),
--                       joined_at. The creator is inserted as 'admin'
--                       by the app right after creating the team.
--   * team_settings   — one row per team: who_can_start
--                       ('any_member' | 'admin_only', default
--                       'any_member'), default_require_waiting_room
--                       (default true), default_duration (default
--                       '40m limit').
--   * meetings.team_id — nullable FK to teams, ON DELETE SET NULL:
--                       deleting a team keeps its past meetings as
--                       ordinary personal meetings of their hosts.
--
-- WHAT STAYS WORKING after this runs:
--   - All personal meetings are untouched (team_id NULL).
--   - The token / admit routes read team_id best-effort: a meeting
--     without the column (SQL not run yet) is treated as personal.
--   - No existing RLS policy on meetings / profiles is changed.
-- =====================================================================

-- 0. Helper functions (SECURITY DEFINER so the RLS policies below
--    can ask "is this caller an admin/member of that team" without
--    tripping over RLS on team_members itself).
create or replace function public.is_team_member(p_team_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.team_members
    where team_id = p_team_id and user_id = auth.uid()
  );
$$;

create or replace function public.is_team_admin(p_team_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.team_members
    where team_id = p_team_id and user_id = auth.uid() and role = 'admin'
  ) or exists (
    select 1 from public.teams
    where id = p_team_id and created_by = auth.uid()
  );
$$;

-- 1. teams
create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamp with time zone default now() not null
);

alter table public.teams enable row level security;

drop policy if exists "Teams readable by creator and members" on public.teams;
create policy "Teams readable by creator and members"
  on public.teams for select
  using (created_by = auth.uid() or public.is_team_member(id));

drop policy if exists "Teams created by the signed-in user" on public.teams;
create policy "Teams created by the signed-in user"
  on public.teams for insert
  with check (auth.uid() = created_by);

drop policy if exists "Teams changed by a team admin" on public.teams;
create policy "Teams changed by a team admin"
  on public.teams for update
  using (public.is_team_admin(id));

drop policy if exists "Teams deleted by a team admin" on public.teams;
create policy "Teams deleted by a team admin"
  on public.teams for delete
  using (public.is_team_admin(id));

-- 2. team_members
create table if not exists public.team_members (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('admin', 'member')),
  joined_at timestamp with time zone default now() not null,
  unique (team_id, user_id)
);

create index if not exists idx_team_members_team on public.team_members(team_id);
create index if not exists idx_team_members_user on public.team_members(user_id);

alter table public.team_members enable row level security;

drop policy if exists "Team members readable by team members" on public.team_members;
create policy "Team members readable by team members"
  on public.team_members for select
  using (public.is_team_member(team_id) or public.is_team_admin(team_id));

-- Only a team admin (the creator counts as admin, so they can add
-- themselves right after creating the team) can add members. A
-- non-admin insert fails RLS — the app surfaces that honestly.
drop policy if exists "Team members added by a team admin" on public.team_members;
create policy "Team members added by a team admin"
  on public.team_members for insert
  with check (public.is_team_admin(team_id));

-- An admin removes anyone; a member removes only themselves (leave).
drop policy if exists "Team members removed by an admin or self" on public.team_members;
create policy "Team members removed by an admin or self"
  on public.team_members for delete
  using (public.is_team_admin(team_id) or auth.uid() = user_id);

-- 3. team_settings (one row per team)
create table if not exists public.team_settings (
  team_id uuid primary key references public.teams(id) on delete cascade,
  who_can_start text not null default 'any_member' check (who_can_start in ('any_member', 'admin_only')),
  default_require_waiting_room boolean not null default true,
  default_duration text not null default '40m limit',
  updated_at timestamp with time zone default now() not null
);

alter table public.team_settings enable row level security;

drop policy if exists "Team settings readable by team members" on public.team_settings;
create policy "Team settings readable by team members"
  on public.team_settings for select
  using (public.is_team_member(team_id) or public.is_team_admin(team_id));

drop policy if exists "Team settings written by a team admin" on public.team_settings;
create policy "Team settings written by a team admin"
  on public.team_settings for insert
  with check (public.is_team_admin(team_id));

drop policy if exists "Team settings changed by a team admin" on public.team_settings;
create policy "Team settings changed by a team admin"
  on public.team_settings for update
  using (public.is_team_admin(team_id));

-- 4. meetings.team_id — nullable: NULL means a personal meeting.
alter table public.meetings
  add column if not exists team_id uuid references public.teams(id) on delete set null;

create index if not exists idx_meetings_team on public.meetings(team_id);

-- 5. Realtime (same pattern as the canonical schema: team rows sync
--    live; harmless if the publication already lists them).
do $$
begin
  begin
    alter publication supabase_realtime add table public.teams;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.team_members;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.team_settings;
  exception when duplicate_object then null;
  end;
end $$;

-- Verify (run after this file; all four checks must pass):
--   select table_name from information_schema.tables
--   where table_schema = 'public'
--     and table_name in ('teams', 'team_members', 'team_settings');
--   -- expected: 3 rows.
--   select column_name from information_schema.columns
--   where table_schema = 'public' and table_name = 'meetings'
--     and column_name = 'team_id';
--   -- expected: 1 row.
--   select proname from pg_proc
--   where pronamespace = 'public'::regnamespace
--     and proname in ('is_team_member', 'is_team_admin');
--   -- expected: 2 rows.
--   select policyname from pg_policies
--   where schemaname = 'public'
--     and tablename in ('teams', 'team_members', 'team_settings');
--   -- expected: 4 (teams) + 3 (team_members) + 3 (team_settings) = 10 rows.
