-- Acceso por rol para las vistas Planeación y Organizaciones
-- Ejecutar en Supabase → SQL Editor. No contiene contraseñas.
-- Los usuarios se crean en Authentication → Users (la contraseña la define quien administra).

create table if not exists public.perfiles (
  user_id uuid not null references auth.users(id) on delete cascade,
  rol text not null check (rol in ('planeacion','organizaciones')),
  nombre text,
  organizacion text,
  primary key (user_id, rol)
);

alter table public.perfiles enable row level security;
grant select on public.perfiles to authenticated;

drop policy if exists "ver_propio_perfil" on public.perfiles;
create policy "ver_propio_perfil" on public.perfiles
  for select to authenticated using (user_id = auth.uid());

-- Dar acceso a Planeación a un usuario ya creado en Authentication.
-- Sustituya el correo por el del usuario (no lo publique en el repositorio).
insert into public.perfiles (user_id, rol, nombre, organizacion)
select id, 'planeacion', 'Planeación', 'Gobernación de Caldas'
from auth.users where email = 'CORREO_DEL_USUARIO@ejemplo.com'
on conflict do nothing;

-- Para Organizaciones, repita con rol 'organizaciones'.
