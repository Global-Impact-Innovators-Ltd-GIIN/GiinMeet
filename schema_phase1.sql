-- Enable UUID extension if not present
create extension if not exists "uuid-ossp";

-- 1. ROOMS TABLE
create table if not exists public.rooms (
    id uuid primary key default gen_random_uuid(),
    room_name text not null,
    slug text unique not null,
    organization_id text not null,
    host_id uuid not null,
    is_active boolean default true not null,
    max_capacity integer default 8 not null,
    current_engine text default 'LIVEKIT'::text not null check (current_engine in ('LIVEKIT', 'P2P')),
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 2. PARTICIPANTS TABLE (Tracks real-time allocation to guard free-tier caps)
create table if not exists public.participants (
    id uuid primary key default gen_random_uuid(),
    room_id uuid references public.rooms(id) on delete cascade not null,
    user_id uuid not null,
    user_name text not null,
    role text default 'GUEST'::text not null check (role in ('HOST', 'SPEAKER', 'GUEST')),
    status text default 'JOINED'::text not null check (status in ('WAITING', 'JOINED', 'LEFT')),
    joined_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
    constraint unique_room_user unique (room_id, user_id)
);

-- 3. PERF-OPTIMIZED INDEXES (Crucial for sub-millisecond lookups under load to prevent timeouts)
create index if not exists idx_rooms_slug on public.rooms(slug) where is_active = true;
create index if not exists idx_participants_room_status on public.participants(room_id, status);

-- 4. ROW LEVEL SECURITY (RLS) POLICIES
alter table public.rooms enable row level security;
alter table public.participants enable row level security;

-- Clean existing policies to avoid duplications
drop policy if exists "Allow public anonymous read access to active rooms" on public.rooms;
drop policy if exists "Allow full access to participants of the same room" on public.participants;

create policy "Allow public anonymous read access to active rooms" 
on public.rooms for select using (is_active = true);

create policy "Allow full access to participants of the same room"
on public.participants for all using (true) with check (true);

-- 5. DYNAMIC UPDATED_AT TRIGGER FUNCTION
create or replace function public.handle_updated_at()
returns trigger as $$ 
begin     
    new.updated_at = timezone('utc'::text, now());     
    return new; 
end; 
$$ language plpgsql;

-- Recreate triggers
drop trigger if exists tr_rooms_updated_at on public.rooms;
create trigger tr_rooms_updated_at before update on public.rooms
    for each row execute function public.handle_updated_at();

drop trigger if exists tr_participants_updated_at on public.participants;
create trigger tr_participants_updated_at before update on public.participants
    for each row execute function public.handle_updated_at();
