-- ═══════════════════════════════════════════════════════════════
-- 0001 — Schéma de base d'Arrow CRM
--
-- Contexte : 14 028 leads de prospection, données nominatives
-- (raison sociale, téléphone, adresse, SIREN, notes commerciales).
-- Tout est en accès restreint : aucune table n'est lisible par le
-- rôle `anon`. Les règles d'accès sont dans 0002_rls.sql.
-- ═══════════════════════════════════════════════════════════════

create extension if not exists pg_trgm;

-- ── Rôles applicatifs ────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_type where typname = 'app_role') then
    create type public.app_role as enum ('directeur', 'commercial');
  end if;
end
$$;

-- ── Utilisateurs de l'application ────────────────────────────────
-- Une ligne par compte autorisé. Créée automatiquement à l'invitation
-- (voir le trigger plus bas). `active` permet de couper l'accès d'un
-- commercial qui quitte l'agence sans supprimer son historique.
create table if not exists public.app_users (
  id               uuid primary key references auth.users(id) on delete cascade,
  email            text not null,
  nom              text,
  role             public.app_role not null default 'commercial',
  -- Rattache le compte aux leads : correspond au champ `commercial`
  -- des données Arrow (ex. « G.Gay »). Sert à l'affectation et aux
  -- statistiques, pas au contrôle d'accès.
  commercial_code  text,
  active           boolean not null default true,
  created_at       timestamptz not null default now()
);

comment on table public.app_users is
  'Comptes autorisés. Un compte inactif conserve son historique mais perd tout accès.';

-- ── Leads ────────────────────────────────────────────────────────
-- Données de référence importées depuis Arrow. En lecture seule pour
-- l'application : tout réimport passe par le script d'import, qui
-- utilise la clé de service et contourne donc RLS.
create table if not exists public.leads (
  id                bigint primary key,
  siren             text not null unique,
  societe           text,
  profession        text,
  departement       smallint,
  ville             text,
  adresse           text,
  telephone         text,
  priorite          text not null,
  statut            text,
  -- `date_rdv` est conservé tel qu'il arrive d'Arrow (JJ/MM/AAAA) pour
  -- l'affichage ; `date_rdv_date` est la version typée, calculée à
  -- l'import, sur laquelle le tri chronologique s'appuie réellement.
  date_rdv          text,
  date_rdv_date     date,
  nb_rdvs           integer default 0,
  nb_audits         integer default 0,
  premiere_periode  text,
  derniere_periode  text,
  commercial        text,
  notes             text,
  lien_arrow        text,
  imported_at       timestamptz not null default now(),

  -- Colonne de recherche : exactement les champs interrogés par la
  -- barre de recherche du front (société, ville, profession,
  -- commercial, SIREN), normalisés une fois à l'écriture plutôt
  -- qu'à chaque requête.
  search_text text generated always as (
    lower(
      coalesce(societe, '')    || ' ' ||
      coalesce(ville, '')      || ' ' ||
      coalesce(profession, '') || ' ' ||
      coalesce(commercial, '') || ' ' ||
      coalesce(siren, '')
    )
  ) stored
);

-- Index de filtrage. `priorite` est le discriminant de chaque onglet
-- et se combine systématiquement aux autres filtres, d'où les index
-- composites plutôt que des index isolés.
create index if not exists leads_priorite_idx            on public.leads (priorite);
create index if not exists leads_priorite_dept_idx       on public.leads (priorite, departement);
create index if not exists leads_priorite_profession_idx on public.leads (priorite, profession);
create index if not exists leads_priorite_commercial_idx on public.leads (priorite, commercial);
create index if not exists leads_priorite_statut_idx     on public.leads (priorite, statut);

-- Recherche sous-chaîne (« carross » doit matcher « MS Carrosserie »).
-- Un index B-tree ne sert à rien pour un LIKE '%…%' : il faut du trigramme.
create index if not exists leads_search_trgm_idx
  on public.leads using gin (search_text gin_trgm_ops);

-- Colonnes de tri exposées par les en-têtes de tableau.
create index if not exists leads_societe_idx  on public.leads (societe);
create index if not exists leads_nb_rdvs_idx  on public.leads (nb_rdvs desc);
create index if not exists leads_date_rdv_idx on public.leads (date_rdv_date);

-- ── Notes commerciales ───────────────────────────────────────────
-- Historique saisi dans l'application, distinct du champ `notes`
-- des leads qui contient l'historique figé venu d'Arrow.
create table if not exists public.lead_notes (
  id          uuid primary key default gen_random_uuid(),
  lead_id     bigint not null references public.leads(id) on delete cascade,
  author_id   uuid not null references public.app_users(id),
  text        text not null check (length(text) between 1 and 10000),
  created_at  timestamptz not null default now()
);

create index if not exists lead_notes_lead_idx   on public.lead_notes (lead_id, created_at);
create index if not exists lead_notes_author_idx on public.lead_notes (author_id);

-- ── Statuts d'appel et de rendez-vous ────────────────────────────
-- Un état partagé par lead, pas un historique : une ligne par lead,
-- écrasée à chaque mise à jour.
create table if not exists public.lead_issues (
  lead_id     bigint primary key references public.leads(id) on delete cascade,
  issue_tel   text not null default '',
  issue_rdv   text not null default '',
  updated_by  uuid references public.app_users(id),
  updated_at  timestamptz not null default now()
);

create index if not exists lead_issues_tel_idx on public.lead_issues (issue_tel) where issue_tel <> '';
create index if not exists lead_issues_rdv_idx on public.lead_issues (issue_rdv) where issue_rdv <> '';

-- ── Agenda ───────────────────────────────────────────────────────
-- Les champs société, téléphone, ville et commercial sont recopiés
-- volontairement : l'agenda doit rester lisible même si le lead est
-- retiré d'un réimport, et la vue agenda n'a alors aucune jointure
-- à faire pour s'afficher.
create table if not exists public.agenda (
  id           uuid primary key default gen_random_uuid(),
  lead_id      bigint references public.leads(id) on delete set null,
  owner_id     uuid not null references public.app_users(id),
  siren        text,
  societe      text,
  priorite     text,
  telephone    text,
  commercial   text,
  departement  text,
  ville        text,
  date_rdv     date not null,
  heure_rdv    text,
  note_rdv     text default '',
  disabled     boolean not null default false,
  created_at   timestamptz not null default now()
);

create index if not exists agenda_date_idx  on public.agenda (date_rdv) where not disabled;
create index if not exists agenda_owner_idx on public.agenda (owner_id);
create index if not exists agenda_lead_idx  on public.agenda (lead_id);

-- ── Création automatique du profil applicatif ────────────────────
-- Déclenché quand tu invites quelqu'un depuis le dashboard Supabase.
-- L'inscription libre est désactivée (voir docs/DEPLOIEMENT.md) :
-- sans invitation, aucune ligne auth.users n'est créée, donc aucun
-- profil ici.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.app_users (id, email, nom)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'nom', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();
