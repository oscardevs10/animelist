-- animelist: una fila por anime; cada usuario solo puede ver y modificar sus propias filas (RLS).
-- Ejecutar una vez en Supabase → SQL Editor. Se puede volver a ejecutar sin romper nada.

create table if not exists public.animes (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  id         text        not null check (char_length(id) between 1 and 64),
  data       jsonb       not null check (jsonb_typeof(data) = 'object' and pg_column_size(data) < 20000),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

alter table public.animes enable row level security;

grant select, insert, update, delete on public.animes to authenticated;

drop policy if exists "ver mis animes" on public.animes;
drop policy if exists "crear mis animes" on public.animes;
drop policy if exists "editar mis animes" on public.animes;
drop policy if exists "borrar mis animes" on public.animes;

create policy "ver mis animes" on public.animes
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "crear mis animes" on public.animes
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "editar mis animes" on public.animes
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "borrar mis animes" on public.animes
  for delete to authenticated using ((select auth.uid()) = user_id);

create or replace function public.animes_touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists animes_touch on public.animes;
create trigger animes_touch before update on public.animes
  for each row execute function public.animes_touch_updated_at();
