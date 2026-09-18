-- Base de datos de la sincronización de Mi plata (con cuenta de Google).
-- Se corre una sola vez en Supabase: SQL Editor → New query → pegar → Run.
--
-- Cada persona tiene una fila con todos sus datos. La tabla no tiene
-- políticas de RLS: nadie la puede tocar directamente. Solo se usa por las
-- dos funciones, que leen y guardan únicamente la fila de quien tiene la
-- sesión iniciada (auth.uid()).

-- Lo de la versión anterior, que usaba un código en vez de una cuenta
drop function if exists public.leer_estado(text);
drop function if exists public.guardar_estado(text, jsonb);
drop table if exists public.estados;

create table if not exists public.datos (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  data        jsonb not null,
  actualizado timestamptz not null default now()
);

alter table public.datos enable row level security;
revoke all on public.datos from anon, authenticated;

create or replace function public.leer_mis_datos()
returns table (data jsonb, actualizado timestamptz)
language sql
security definer
set search_path = public
as $$
  select d.data, d.actualizado from public.datos d where d.user_id = auth.uid();
$$;

create or replace function public.guardar_mis_datos(p_data jsonb)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare t timestamptz;
begin
  if auth.uid() is null then raise exception 'hay que iniciar sesion'; end if;
  if octet_length(p_data::text) > 2000000 then raise exception 'datos demasiado grandes'; end if;
  insert into public.datos (user_id, data, actualizado)
  values (auth.uid(), p_data, now())
  on conflict (user_id) do update set data = excluded.data, actualizado = excluded.actualizado
  returning datos.actualizado into t;
  return t;
end;
$$;

revoke execute on function public.leer_mis_datos() from public, anon;
revoke execute on function public.guardar_mis_datos(jsonb) from public, anon;
grant execute on function public.leer_mis_datos() to authenticated;
grant execute on function public.guardar_mis_datos(jsonb) to authenticated;

notify pgrst, 'reload schema';
