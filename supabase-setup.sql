-- ============================================================
-- BLOCK BLAST MABAR — Supabase Setup SQL (v2)
-- Jalankan ini di Supabase SQL Editor
-- ============================================================

-- 1. Tabel rooms
create table if not exists rooms (
  id text primary key,
  created_at timestamptz default now(),
  host_id text not null,
  status text default 'waiting', -- 'waiting' | 'playing' | 'finished'
  max_players int default 2,
  game_start_at timestamptz,        -- kapan game mulai (untuk timer)
  game_duration int default 180,    -- durasi game dalam detik (default 3 menit)
  round int default 1               -- nomor ronde (untuk rematch)
);

-- 2. Tabel players
create table if not exists players (
  id uuid primary key default gen_random_uuid(),
  room_id text references rooms(id) on delete cascade,
  player_id text not null,
  username text not null,
  board jsonb default '[]',
  pieces jsonb default '[]',
  score int default 0,
  is_game_over boolean default false,
  survival_time int default 0,       -- berapa detik bertahan sebelum game over
  ready_for_rematch boolean default false,  -- untuk rematch
  joined_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(room_id, player_id)
);

-- 3. Tabel leaderboard
create table if not exists leaderboard (
  id uuid primary key default gen_random_uuid(),
  username text not null,
  score int not null,
  survival_time int default 0,
  room_id text,
  played_at timestamptz default now()
);

-- 4. Enable Realtime
alter publication supabase_realtime add table rooms;
alter publication supabase_realtime add table players;
alter publication supabase_realtime add table leaderboard;

-- 5. RLS Policies
alter table rooms enable row level security;
alter table players enable row level security;
alter table leaderboard enable row level security;

create policy "Allow all on rooms" on rooms for all using (true) with check (true);
create policy "Allow all on players" on players for all using (true) with check (true);
create policy "Allow all on leaderboard" on leaderboard for all using (true) with check (true);

-- 6. Indexes
create index if not exists idx_players_room_id on players(room_id);
create index if not exists idx_leaderboard_score on leaderboard(score desc);
