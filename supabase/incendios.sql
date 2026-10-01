-- Módulo de incendios · tablas compartidas por la app móvil y QField
-- Ejecutar en Supabase → SQL Editor. No contiene claves.

create extension if not exists pgcrypto;

-- 1) Reportes de campo (app móvil = 'app', QField = 'qfield')
create table if not exists public.reportes_incendio (
  id uuid primary key default gen_random_uuid(),
  fecha_hora timestamptz not null default now(),
  origen text not null default 'app' check (origen in ('app','qfield')),
  nivel text not null default 'ciudadano' check (nivel in ('ciudadano','tecnico')),
  reportante text,
  municipio text,
  vereda text,
  sitio text,
  cobertura text,
  tipo_fuego text,
  area_ha numeric check (area_ha is null or area_ha >= 0),
  estado text not null default 'Activo' check (estado in ('Activo','Controlado','Extinguido')),
  causa_probable text,
  afectacion text,
  observaciones text,
  fotos text[] default '{}',
  lat double precision not null check (lat between -5 and 14),
  lon double precision not null check (lon between -82 and -66),
  validado boolean not null default false,
  creado_en timestamptz not null default now()
);
create index if not exists reportes_incendio_fecha on public.reportes_incendio (fecha_hora desc);
create index if not exists reportes_incendio_mun on public.reportes_incendio (municipio);

alter table public.reportes_incendio enable row level security;
grant select, insert on public.reportes_incendio to anon;
grant select, insert, update on public.reportes_incendio to authenticated;

-- La ciudadanía (anon) solo ve reportes validados e inserta reportes sin validar
drop policy if exists "ver_validados" on public.reportes_incendio;
create policy "ver_validados" on public.reportes_incendio for select to anon using (validado = true);
drop policy if exists "insertar_ciudadano" on public.reportes_incendio;
create policy "insertar_ciudadano" on public.reportes_incendio for insert to anon with check (validado = false and nivel = 'ciudadano' and origen = 'app');
-- Técnicos con sesión: ven, crean y validan todo
drop policy if exists "tecnicos_todo" on public.reportes_incendio;
create policy "tecnicos_todo" on public.reportes_incendio for all to authenticated using (true) with check (true);

-- 2) Detecciones satelitales (las escribe la función firms-proxy / el puente con la clave de servicio)
create table if not exists public.detecciones_calor (
  id bigint generated always as identity primary key,
  fuente text not null,            -- VIIRS_SNPP_NRT, VIIRS_NOAA20_NRT, VIIRS_NOAA21_NRT, MODIS_NRT
  satelite text,
  fecha_hora timestamptz not null,
  lat double precision not null,
  lon double precision not null,
  frp numeric,
  confianza text,
  dia_noche text,
  unique (fuente, fecha_hora, lat, lon)
);
create index if not exists detecciones_calor_fecha on public.detecciones_calor (fecha_hora desc);
alter table public.detecciones_calor enable row level security;
grant select on public.detecciones_calor to anon, authenticated;
drop policy if exists "leer_detecciones" on public.detecciones_calor;
create policy "leer_detecciones" on public.detecciones_calor for select to anon, authenticated using (true);

-- 3) Fotos: bucket público de lectura y subida desde la app (clave anon)
insert into storage.buckets (id, name, public)
values ('fotos-incendios','fotos-incendios', true)
on conflict (id) do update set public = true;

drop policy if exists "subir_fotos_incendios" on storage.objects;
create policy "subir_fotos_incendios" on storage.objects
  for insert to anon, authenticated with check (bucket_id = 'fotos-incendios');
drop policy if exists "ver_fotos_incendios" on storage.objects;
create policy "ver_fotos_incendios" on storage.objects
  for select to anon, authenticated using (bucket_id = 'fotos-incendios');
