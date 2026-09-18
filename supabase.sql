-- Base de datos de la sincronización de Mi plata.
-- Se corre una sola vez en Supabase: SQL Editor → New query → pegar → Run.
--
-- La tabla no tiene políticas de RLS: nadie la puede leer ni escribir
-- directamente con la clave pública. Solo se toca por las dos funciones,
-- y para eso hay que saber el código de sincronización.

drop table if exists public.estados cascade;

create table public.estados (
  codigo      text primary key,
  data        jsonb not null,
  actualizado timestamptz not null default now()
);

alter table public.estados enable row level security;
revoke all on public.estados from anon, authenticated;

create or replace function public.leer_estado(p_codigo text)
returns table (data jsonb, actualizado timestamptz)
language sql
security definer
set search_path = public
as $$
  select e.data, e.actualizado from public.estados e where e.codigo = p_codigo;
$$;

create or replace function public.guardar_estado(p_codigo text, p_data jsonb)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare t timestamptz;
begin
  if length(p_codigo) < 20 then raise exception 'codigo invalido'; end if;
  if octet_length(p_data::text) > 2000000 then raise exception 'datos demasiado grandes'; end if;
  insert into public.estados (codigo, data, actualizado)
  values (p_codigo, p_data, now())
  on conflict (codigo) do update set data = excluded.data, actualizado = excluded.actualizado
  returning estados.actualizado into t;
  return t;
end;
$$;

grant execute on function public.leer_estado(text) to anon;
grant execute on function public.guardar_estado(text, jsonb) to anon;

notify pgrst, 'reload schema';
