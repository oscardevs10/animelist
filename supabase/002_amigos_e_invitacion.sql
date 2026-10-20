-- animelist 002: perfiles, listas compartidas por enlace y código de invitación para registrarse.
-- Ejecutar una vez en Supabase → SQL Editor, después de schema.sql. Se puede volver a ejecutar.
-- El último SELECT muestra el código de invitación: compártelo solo con tus amigos.

-- Perfiles: uno por usuario. handle = parte aleatoria del enlace para compartir (no se puede adivinar).
create table if not exists public.profiles (
  id         uuid        primary key references auth.users (id) on delete cascade,
  handle     text        not null unique default substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),
  name       text        check (char_length(name) <= 40),
  share      boolean     not null default false,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Cada quien solo lee y edita su perfil, y solo puede cambiar nombre y "compartir".
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (name, share) on public.profiles to authenticated;

drop policy if exists "ver mi perfil" on public.profiles;
drop policy if exists "editar mi perfil" on public.profiles;
create policy "ver mi perfil" on public.profiles
  for select to authenticated using ((select auth.uid()) = id);
create policy "editar mi perfil" on public.profiles
  for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

-- Lista compartida: solo se obtiene sabiendo el handle exacto y si su dueño la compartió.
-- No hay forma de listar todas las listas compartidas. Las notas personales no se comparten.
drop function if exists public.shared_list(text);
create function public.shared_list(p_handle text)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'name', p.name,
    'items', coalesce((select jsonb_agg(a.data - 'notes') from public.animes a where a.user_id = p.id), '[]'::jsonb)
  )
  from public.profiles p
  where p.handle = p_handle and p.share
$$;
revoke all on function public.shared_list(text) from public;
grant execute on function public.shared_list(text) to anon, authenticated;

-- Esquema privado: no lo expone la API de Supabase.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to supabase_auth_admin;

create table if not exists private.settings (
  key   text primary key,
  value text not null
);
insert into private.settings (key, value)
values ('invite_code', 'anime-' || substr(md5(random()::text), 1, 6))
on conflict (key) do nothing;

-- Registro: sin el código de invitación correcto la base rechaza la cuenta (aunque llamen a la API directo).
-- Para quitar el requisito: update private.settings set value = '' where key = 'invite_code';
create or replace function private.check_invite()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  expected text;
begin
  select value into expected from private.settings where key = 'invite_code';
  if coalesce(expected, '') <> ''
     and lower(trim(coalesce(new.raw_user_meta_data ->> 'invite', ''))) <> lower(trim(expected)) then
    raise exception 'invite_code_invalid';
  end if;
  return new;
end $$;

create or replace function private.create_profile()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end $$;

grant execute on function private.check_invite() to supabase_auth_admin;
grant execute on function private.create_profile() to supabase_auth_admin;

drop trigger if exists check_invite on auth.users;
create trigger check_invite before insert on auth.users
  for each row execute function private.check_invite();

drop trigger if exists create_profile on auth.users;
create trigger create_profile after insert on auth.users
  for each row execute function private.create_profile();

-- Perfiles para las cuentas que ya existían.
insert into public.profiles (id) select id from auth.users on conflict (id) do nothing;

select value as codigo_de_invitacion from private.settings where key = 'invite_code';
