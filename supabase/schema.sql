-- ============================================================
-- scrobble — схема с нуля (новый Supabase project)
-- Порядок: прогнать целиком в SQL Editor.
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- профили ----------

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique
    check (username = lower(username) and username ~ '^[a-z0-9_]{3,32}$'),
  display_name text
    check (display_name is null or char_length(display_name) between 1 and 80),
  bio text check (bio is null or char_length(bio) <= 1000),
  avatar_url text,
  country text check (country is null or char_length(country) <= 80),
  is_public boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is
  'Публичный профиль скробблера. username — id в URL, не меняется без отдельной операции.';

-- ---------- скробблы ----------

create table if not exists public.scrobbles (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  artist text not null check (char_length(artist) between 1 and 500),
  artist_mbid uuid,
  album text check (album is null or char_length(album) <= 500),
  album_mbid uuid,
  album_artist text check (album_artist is null or char_length(album_artist) <= 500),
  track text not null check (char_length(track) between 1 and 500),
  track_mbid uuid,
  duration integer check (duration is null or duration between 0 and 86400),
  played_at timestamptz not null,
  source text not null default 'api'
    check (source in ('api', 'webhook', 'listenbrainz', 'import', 'manual', 'csv')),
  created_at timestamptz not null default now(),
  unique (user_id, artist, track, played_at)
);

create index if not exists scrobbles_user_played_idx
  on public.scrobbles (user_id, played_at desc);
create index if not exists scrobbles_user_artist_idx
  on public.scrobbles (user_id, artist);
create index if not exists scrobbles_user_album_idx
  on public.scrobbles (user_id, album);
create index if not exists scrobbles_user_track_idx
  on public.scrobbles (user_id, track);

-- ---------- сейчас играет ----------

create table if not exists public.now_playing (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  artist text not null,
  album text,
  track text not null,
  duration integer,
  updated_at timestamptz not null default now()
);

-- ---------- лайки ----------

create table if not exists public.track_loves (
  user_id uuid not null references public.profiles (id) on delete cascade,
  artist text not null,
  track text not null,
  loved_at timestamptz not null default now(),
  primary key (user_id, artist, track)
);

create index if not exists track_loves_user_idx
  on public.track_loves (user_id, loved_at desc);

-- ---------- токены клиентов ----------

create table if not exists public.scrobble_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('session', 'webhook', 'listenbrainz')),
  token_hash text not null unique,
  label text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create index if not exists scrobble_tokens_user_idx
  on public.scrobble_tokens (user_id, kind);

-- ---------- запросы авторизации (Last.fm token flow) ----------

create table if not exists public.auth_requests (
  token_hash text primary key,
  user_id uuid references public.profiles (id) on delete cascade,
  approved_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------- импорт ----------

create table if not exists public.import_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  source text not null check (source in ('lastfm', 'csv', 'json')),
  status text not null default 'running'
    check (status in ('running', 'done', 'failed', 'cancelled')),
  total_pages integer not null default 0,
  pages_done integer not null default 0,
  imported bigint not null default 0,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists import_jobs_user_idx
  on public.import_jobs (user_id, started_at desc);

-- ---------- updated_at ----------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ---------- профиль при регистрации ----------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  wanted text;
begin
  wanted := lower(btrim(coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1))));

  if wanted !~ '^[a-z0-9_]{3,32}$' then
    wanted := 'user_' || substr(replace(new.id::text, '-', ''), 1, 12);
  end if;

  if exists (select 1 from public.profiles p where p.username = wanted) then
    wanted := substr(wanted, 1, 25) || '_' || substr(replace(new.id::text, '-', ''), 1, 6);
  end if;

  insert into public.profiles (id, username, display_name)
  values (new.id, wanted, coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), wanted))
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- доступ ----------

create or replace function public.can_view_profile(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = p_user and (p.is_public or p.id = auth.uid())
  );
$$;

create or replace function public.get_profile(p_username text)
returns table (
  id uuid,
  username text,
  display_name text,
  bio text,
  avatar_url text,
  country text,
  is_public boolean,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.id, p.username, p.display_name, p.bio, p.avatar_url,
         p.country, p.is_public, p.created_at
  from public.profiles p
  where p.username = lower(p_username)
    and (p.is_public or p.id = auth.uid());
$$;

create or replace function public.profile_stats(p_username text)
returns json
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_result json;
begin
  select p.id into v_id from public.profiles p where p.username = lower(p_username);
  if v_id is null or not public.can_view_profile(v_id) then
    return null;
  end if;

  select json_build_object(
    'scrobbles', (select count(*) from public.scrobbles s where s.user_id = v_id),
    'artists',   (select count(distinct lower(s.artist)) from public.scrobbles s where s.user_id = v_id),
    'albums',    (select count(distinct lower(s.artist || '|' || coalesce(s.album, ''))) from public.scrobbles s where s.user_id = v_id and s.album is not null),
    'tracks',    (select count(distinct lower(s.artist || '|' || s.track)) from public.scrobbles s where s.user_id = v_id),
    'loved',     (select count(*) from public.track_loves l where l.user_id = v_id),
    'first_play',(select min(s.played_at) from public.scrobbles s where s.user_id = v_id),
    'last_play', (select max(s.played_at) from public.scrobbles s where s.user_id = v_id)
  ) into v_result;

  return v_result;
end;
$$;

-- ---------- топы ----------

create or replace function public.top_items(
  p_username text,
  p_dimension text,
  p_since timestamptz default null,
  p_limit integer default 50
)
returns table (
  artist text,
  title text,
  album text,
  plays bigint,
  duration integer
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_dim text := lower(p_dimension);
  v_limit int := greatest(1, least(coalesce(p_limit, 50), 500));
begin
  select p.id into v_id from public.profiles p where p.username = lower(p_username);
  if v_id is null or not public.can_view_profile(v_id) then
    return;
  end if;

  if v_dim = 'artist' then
    return query
      select s.artist, null::text, null::text, count(*)::bigint, null::integer
      from public.scrobbles s
      where s.user_id = v_id and (p_since is null or s.played_at >= p_since)
      group by s.artist
      order by count(*) desc, s.artist
      limit v_limit;
  elsif v_dim = 'album' then
    return query
      select coalesce(nullif(s.album_artist, ''), s.artist) as artist,
             s.album as title, null::text as album,
             count(*)::bigint as plays, null::integer as duration
      from public.scrobbles s
      where s.user_id = v_id
        and s.album is not null
        and (p_since is null or s.played_at >= p_since)
      group by coalesce(nullif(s.album_artist, ''), s.artist), s.album
      order by count(*) desc, s.album
      limit v_limit;
  elsif v_dim = 'track' then
    return query
      select s.artist, s.track as title,
             (array_agg(s.album order by s.played_at desc))[1] as album,
             count(*)::bigint as plays,
             max(s.duration) as duration
      from public.scrobbles s
      where s.user_id = v_id and (p_since is null or s.played_at >= p_since)
      group by s.artist, s.track
      order by count(*) desc, s.track
      limit v_limit;
  elsif v_dim = 'loved' then
    return query
      select l.artist, l.track as title, null::text, 0::bigint, null::integer
      from public.track_loves l
      where l.user_id = v_id
      order by l.loved_at desc
      limit v_limit;
  else
    raise exception 'unknown dimension: %', p_dimension;
  end if;
end;
$$;

create or replace function public.daily_counts(p_username text, p_days integer default 365)
returns table (day date, plays bigint)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_days int := greatest(1, least(coalesce(p_days, 365), 3650));
begin
  select p.id into v_id from public.profiles p where p.username = lower(p_username);
  if v_id is null or not public.can_view_profile(v_id) then
    return;
  end if;

  return query
    select (s.played_at at time zone 'UTC')::date as day, count(*)::bigint
    from public.scrobbles s
    where s.user_id = v_id
      and s.played_at >= now() - make_interval(days => v_days)
    group by 1
    order by 1;
end;
$$;

create or replace function public.track_history(
  p_username text,
  p_artist text,
  p_track text,
  p_limit integer default 100
)
returns setof public.scrobbles
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  select p.id into v_id from public.profiles p where p.username = lower(p_username);
  if v_id is null or not public.can_view_profile(v_id) then
    return;
  end if;

  return query
    select s.* from public.scrobbles s
    where s.user_id = v_id
      and lower(s.artist) = lower(p_artist)
      and lower(s.track) = lower(p_track)
    order by s.played_at desc
    limit greatest(1, least(coalesce(p_limit, 100), 500));
end;
$$;

create or replace function public.artist_page(
  p_username text,
  p_artist text,
  p_limit integer default 50
)
returns json
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_limit int := greatest(1, least(coalesce(p_limit, 50), 200));
  v_result json;
begin
  select p.id into v_id from public.profiles p where p.username = lower(p_username);
  if v_id is null or not public.can_view_profile(v_id) then
    return null;
  end if;

  select json_build_object(
    'plays', (select count(*) from public.scrobbles s where s.user_id = v_id and lower(s.artist) = lower(p_artist)),
    'first_play', (select min(s.played_at) from public.scrobbles s where s.user_id = v_id and lower(s.artist) = lower(p_artist)),
    'last_play', (select max(s.played_at) from public.scrobbles s where s.user_id = v_id and lower(s.artist) = lower(p_artist)),
    'tracks', coalesce((
      select json_agg(t order by t.plays desc)
      from (
        select s.track as title, max(s.album) as album, count(*)::bigint as plays, max(s.duration) as duration
        from public.scrobbles s
        where s.user_id = v_id and lower(s.artist) = lower(p_artist)
        group by s.track
        order by count(*) desc, s.track
        limit v_limit
      ) t
    ), '[]'::json),
    'albums', coalesce((
      select json_agg(a order by a.plays desc)
      from (
        select s.album as title, count(*)::bigint as plays
        from public.scrobbles s
        where s.user_id = v_id and lower(s.artist) = lower(p_artist) and s.album is not null
        group by s.album
        order by count(*) desc, s.album
        limit v_limit
      ) a
    ), '[]'::json)
  ) into v_result;

  return v_result;
end;
$$;

create or replace function public.album_page(
  p_username text,
  p_artist text,
  p_album text,
  p_limit integer default 100
)
returns json
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_limit int := greatest(1, least(coalesce(p_limit, 100), 300));
  v_result json;
begin
  select p.id into v_id from public.profiles p where p.username = lower(p_username);
  if v_id is null or not public.can_view_profile(v_id) then
    return null;
  end if;

  select json_build_object(
    'artist', p_artist,
    'album', p_album,
    'plays', (select count(*) from public.scrobbles s where s.user_id = v_id
      and lower(coalesce(nullif(s.album_artist, ''), s.artist)) = lower(p_artist)
      and lower(s.album) = lower(p_album)),
    'first_play', (select min(s.played_at) from public.scrobbles s where s.user_id = v_id
      and lower(coalesce(nullif(s.album_artist, ''), s.artist)) = lower(p_artist)
      and lower(s.album) = lower(p_album)),
    'last_play', (select max(s.played_at) from public.scrobbles s where s.user_id = v_id
      and lower(coalesce(nullif(s.album_artist, ''), s.artist)) = lower(p_artist)
      and lower(s.album) = lower(p_album)),
    'tracks', coalesce((
      select json_agg(t order by t.plays desc)
      from (
        select s.track as title, count(*)::bigint as plays, max(s.duration) as duration
        from public.scrobbles s
        where s.user_id = v_id
          and lower(coalesce(nullif(s.album_artist, ''), s.artist)) = lower(p_artist)
          and lower(s.album) = lower(p_album)
        group by s.track
        order by count(*) desc, s.track
        limit v_limit
      ) t
    ), '[]'::json)
  ) into v_result;

  return v_result;
end;
$$;

create or replace function public.track_page(
  p_username text,
  p_artist text,
  p_track text,
  p_limit integer default 100
)
returns json
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_limit int := greatest(1, least(coalesce(p_limit, 100), 500));
  v_result json;
begin
  select p.id into v_id from public.profiles p where p.username = lower(p_username);
  if v_id is null or not public.can_view_profile(v_id) then
    return null;
  end if;

  select json_build_object(
    'artist', p_artist,
    'track', p_track,
    'album', (select (array_agg(s.album order by s.played_at desc))[1]
      from public.scrobbles s
      where s.user_id = v_id and lower(s.artist) = lower(p_artist) and lower(s.track) = lower(p_track)),
    'duration', (select max(s.duration)
      from public.scrobbles s
      where s.user_id = v_id and lower(s.artist) = lower(p_artist) and lower(s.track) = lower(p_track)),
    'plays', (select count(*) from public.scrobbles s
      where s.user_id = v_id and lower(s.artist) = lower(p_artist) and lower(s.track) = lower(p_track)),
    'first_play', (select min(s.played_at) from public.scrobbles s
      where s.user_id = v_id and lower(s.artist) = lower(p_artist) and lower(s.track) = lower(p_track)),
    'last_play', (select max(s.played_at) from public.scrobbles s
      where s.user_id = v_id and lower(s.artist) = lower(p_artist) and lower(s.track) = lower(p_track)),
    'loved', exists(select 1 from public.track_loves l
      where l.user_id = v_id and lower(l.artist) = lower(p_artist) and lower(l.track) = lower(p_track)),
    'history', coalesce((
      select json_agg(h order by h.played_at desc)
      from (
        select s.played_at, s.album
        from public.scrobbles s
        where s.user_id = v_id and lower(s.artist) = lower(p_artist) and lower(s.track) = lower(p_track)
        order by s.played_at desc
        limit v_limit
      ) h
    ), '[]'::json)
  ) into v_result;

  return v_result;
end;
$$;

-- ---------- RLS ----------

alter table public.profiles enable row level security;
alter table public.scrobbles enable row level security;
alter table public.now_playing enable row level security;
alter table public.track_loves enable row level security;
alter table public.scrobble_tokens enable row level security;
alter table public.import_jobs enable row level security;
alter table public.auth_requests enable row level security;

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles
  for select using (is_public or id = auth.uid());

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists scrobbles_read on public.scrobbles;
create policy scrobbles_read on public.scrobbles
  for select using (public.can_view_profile(user_id));

drop policy if exists now_playing_read on public.now_playing;
create policy now_playing_read on public.now_playing
  for select using (public.can_view_profile(user_id));

drop policy if exists loves_read on public.track_loves;
create policy loves_read on public.track_loves
  for select using (public.can_view_profile(user_id));

drop policy if exists loves_insert_own on public.track_loves;
create policy loves_insert_own on public.track_loves
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists loves_delete_own on public.track_loves;
create policy loves_delete_own on public.track_loves
  for delete to authenticated using (user_id = auth.uid());

drop policy if exists now_playing_write_own on public.now_playing;
create policy now_playing_write_own on public.now_playing
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists imports_read_own on public.import_jobs;
create policy imports_read_own on public.import_jobs
  for select using (user_id = auth.uid());

-- scrobble_tokens: ни одного policy — доступ только service role (Edge Functions).

grant usage on schema public to anon, authenticated;
grant select on public.profiles, public.scrobbles, public.now_playing,
  public.track_loves to anon, authenticated;
grant select on public.import_jobs to authenticated;
grant update (display_name, bio, avatar_url, country, is_public)
  on public.profiles to authenticated;
grant execute on function public.get_profile(text) to anon, authenticated;
grant execute on function public.profile_stats(text) to anon, authenticated;
grant execute on function public.top_items(text, text, timestamptz, integer) to anon, authenticated;
grant execute on function public.daily_counts(text, integer) to anon, authenticated;
grant execute on function public.track_history(text, text, text, integer) to anon, authenticated;
grant execute on function public.artist_page(text, text, integer) to anon, authenticated;
grant execute on function public.album_page(text, text, text, integer) to anon, authenticated;
grant execute on function public.track_page(text, text, text, integer) to anon, authenticated;
grant execute on function public.can_view_profile(uuid) to anon, authenticated;
