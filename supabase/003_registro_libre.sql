-- animelist 003: registro libre con el enlace (sin código de invitación) y el historial
-- de días ("log") tampoco se comparte, igual que las notas.
-- Ejecutar una vez en Supabase → SQL Editor, después de 002. Se puede volver a ejecutar.

drop trigger if exists check_invite on auth.users;
drop function if exists private.check_invite();
drop table if exists private.settings;

create or replace function public.shared_list(p_handle text)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'name', p.name,
    'items', coalesce((select jsonb_agg(a.data - 'notes' - 'log') from public.animes a where a.user_id = p.id), '[]'::jsonb)
  )
  from public.profiles p
  where p.handle = p_handle and p.share
$$;

select 'Listo: cualquiera con el enlace puede registrarse' as resultado;
