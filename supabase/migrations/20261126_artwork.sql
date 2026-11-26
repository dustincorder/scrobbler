-- Общий кэш обложек/аватаров. Ключи — lowercased имена; album='' для kind='artist'.
-- image_url NULL = уже искали и не нашли (перепроверка не чаще MISS_TTL в функции).

create table if not exists public.artwork (
  kind text not null check (kind in ('artist', 'album')),
  artist text not null,
  album text not null default '',
  image_url text,
  fetched_at timestamptz not null default now(),
  primary key (kind, artist, album)
);

comment on table public.artwork is
  'Кэш картинок из Deezer/iTunes. Пишет только Edge Function (service role).';

alter table public.artwork enable row level security;
-- Политик нет: чтение только через GET /artwork, запись — service role.

-- Уникальные (артист, альбом) пары пользователя для бэкфилла обложек.
create or replace function public.distinct_artwork_keys(p_user uuid)
returns table (artist text, album text)
language sql stable as
$$
  select artist, album from public.scrobbles
   where user_id = p_user and album is not null
   group by artist, album
  union
  select artist, null from public.scrobbles
   where user_id = p_user
   group by artist;
$$;
