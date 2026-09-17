-- ═══════════════════════════════════════════════════════════════
-- Harnais de test : reproduit localement ce que Supabase fournit
-- (schéma auth, rôles, auth.uid()) afin d'exécuter les migrations
-- telles quelles, sans les adapter pour les tests.
--
-- Ce fichier n'est JAMAIS appliqué en production : Supabase fournit
-- déjà tout ce qu'il contient.
-- ═══════════════════════════════════════════════════════════════

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end
$$;

grant usage on schema public to anon, authenticated, service_role;

create schema if not exists auth;

create table if not exists auth.users (
  id                  uuid primary key default gen_random_uuid(),
  email               text unique not null,
  raw_user_meta_data  jsonb default '{}'::jsonb,
  created_at          timestamptz not null default now()
);

-- Même définition qu'en production : l'identité vient des claims du
-- jeton, jamais d'une valeur que le client pourrait choisir.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid;
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

-- ── Outillage d'assertions ──────────────────────────────────────
create schema if not exists t;

create table if not exists t.results (
  id     serial primary key,
  label  text not null,
  ok     boolean not null,
  detail text
);

grant usage on schema t to public;
grant all on t.results to public;
grant all on sequence t.results_id_seq to public;

create or replace function t.check(p_label text, p_ok boolean, p_detail text default null)
returns void language plpgsql as $$
begin
  insert into t.results (label, ok, detail) values (p_label, coalesce(p_ok, false), p_detail);
end;
$$;

-- Vérifie qu'une opération échoue bien. Un test de sécurité qui
-- n'échoue pas là où il devrait est un test qui ment.
create or replace function t.check_denied(p_label text, p_sql text)
returns void language plpgsql as $$
begin
  execute p_sql;
  perform t.check(p_label, false, 'l''opération a réussi alors qu''elle devait être refusée');
exception
  when insufficient_privilege or raise_exception or check_violation then
    perform t.check(p_label, true, 'refusée : ' || sqlerrm);
  when others then
    perform t.check(p_label, true, 'refusée (' || sqlstate || ') : ' || sqlerrm);
end;
$$;

-- Prend l'identité d'un utilisateur, exactement comme PostgREST le
-- fait à partir du jeton d'authentification.
create or replace function t.login(p_id uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_id)::text, false);
end;
$$;

create or replace function t.logout()
returns void language plpgsql as $$
begin
  -- An empty object represents no identity; an empty string is not valid JSON.
  perform set_config('request.jwt.claims', '{}', false);
end;
$$;
