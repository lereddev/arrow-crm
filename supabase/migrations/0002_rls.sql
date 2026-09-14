-- ═══════════════════════════════════════════════════════════════
-- 0002 — Row Level Security
--
-- Modèle retenu : lecture partagée dans l'agence (leads, notes,
-- statuts, agenda), écriture bornée à son propre travail. Le rôle
-- `directeur` peut corriger et supprimer ce que les commerciaux ont
-- saisi. Personne n'écrit dans `leads` depuis l'application.
--
-- Le rôle `anon` (visiteur non connecté) n'a aucune policy : toute
-- requête non authentifiée renvoie zéro ligne, jamais une erreur
-- exploitable.
-- ═══════════════════════════════════════════════════════════════

-- ── Helpers ──────────────────────────────────────────────────────
-- SECURITY DEFINER est indispensable ici : ces fonctions lisent
-- app_users, qui est elle-même sous RLS. Sans cela, une policy sur
-- app_users s'appelant elle-même provoquerait une récursion infinie.
-- `search_path` est figé pour qu'aucun schéma injecté ne puisse
-- détourner la résolution des noms.

create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.app_users
    where id = auth.uid() and active
  );
$$;

create or replace function public.is_directeur()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.app_users
    where id = auth.uid() and active and role = 'directeur'
  );
$$;

revoke all on function public.is_active_user() from public, anon;
revoke all on function public.is_directeur()   from public, anon;
grant execute on function public.is_active_user() to authenticated;
grant execute on function public.is_directeur()   to authenticated;

-- ── Activation ───────────────────────────────────────────────────
alter table public.app_users  enable row level security;
alter table public.leads      enable row level security;
alter table public.lead_notes enable row level security;
alter table public.lead_issues enable row level security;
alter table public.agenda     enable row level security;

-- Aucune table ne doit rester accessible au rôle anonyme.
revoke all on public.app_users, public.leads, public.lead_notes,
              public.lead_issues, public.agenda
  from anon;

grant select on public.leads to authenticated;
grant select, insert, update, delete on public.lead_notes  to authenticated;
grant select, insert, update, delete on public.lead_issues to authenticated;
grant select, insert, update, delete on public.agenda      to authenticated;
grant select, update on public.app_users to authenticated;

-- ── app_users ────────────────────────────────────────────────────
drop policy if exists app_users_select on public.app_users;
create policy app_users_select on public.app_users
  for select to authenticated
  using (public.is_active_user());

-- Chacun peut corriger son propre nom. Le rôle, le rattachement
-- commercial et l'activation ne se changent pas depuis l'application :
-- ils relèvent du dashboard Supabase ou d'un directeur.
drop policy if exists app_users_update_self on public.app_users;
create policy app_users_update_self on public.app_users
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

drop policy if exists app_users_update_directeur on public.app_users;
create policy app_users_update_directeur on public.app_users
  for update to authenticated
  using (public.is_directeur())
  with check (public.is_directeur());

-- Garde-fou : une policy UPDATE ne peut pas empêcher un utilisateur
-- de modifier une colonne précise. Ce trigger le fait.
create or replace function public.guard_app_users_privileges()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public.is_directeur() then
    return new;
  end if;
  if new.role is distinct from old.role
     or new.active is distinct from old.active
     or new.commercial_code is distinct from old.commercial_code
     or new.email is distinct from old.email then
    raise exception 'Seul un directeur peut modifier le rôle, le rattachement ou l''activation d''un compte';
  end if;
  return new;
end;
$$;

drop trigger if exists app_users_guard on public.app_users;
create trigger app_users_guard
  before update on public.app_users
  for each row execute function public.guard_app_users_privileges();

-- ── leads ────────────────────────────────────────────────────────
-- Lecture seule pour toute l'agence. Aucune policy d'écriture :
-- l'import passe par la clé de service, qui n'est pas soumise à RLS.
drop policy if exists leads_select on public.leads;
create policy leads_select on public.leads
  for select to authenticated
  using (public.is_active_user());

-- ── lead_notes ───────────────────────────────────────────────────
drop policy if exists lead_notes_select on public.lead_notes;
create policy lead_notes_select on public.lead_notes
  for select to authenticated
  using (public.is_active_user());

-- On n'écrit une note qu'en son propre nom : `author_id` ne peut pas
-- être usurpé même en forgeant la requête à la main.
drop policy if exists lead_notes_insert on public.lead_notes;
create policy lead_notes_insert on public.lead_notes
  for insert to authenticated
  with check (public.is_active_user() and author_id = auth.uid());

drop policy if exists lead_notes_update on public.lead_notes;
create policy lead_notes_update on public.lead_notes
  for update to authenticated
  using (author_id = auth.uid() or public.is_directeur())
  with check (author_id = auth.uid() or public.is_directeur());

drop policy if exists lead_notes_delete on public.lead_notes;
create policy lead_notes_delete on public.lead_notes
  for delete to authenticated
  using (author_id = auth.uid() or public.is_directeur());

-- ── lead_issues ──────────────────────────────────────────────────
-- Statut partagé : n'importe quel commercial actif peut le poser ou
-- le corriger, c'est l'état courant du lead pour toute l'agence.
drop policy if exists lead_issues_select on public.lead_issues;
create policy lead_issues_select on public.lead_issues
  for select to authenticated
  using (public.is_active_user());

drop policy if exists lead_issues_insert on public.lead_issues;
create policy lead_issues_insert on public.lead_issues
  for insert to authenticated
  with check (public.is_active_user() and updated_by = auth.uid());

drop policy if exists lead_issues_update on public.lead_issues;
create policy lead_issues_update on public.lead_issues
  for update to authenticated
  using (public.is_active_user())
  with check (public.is_active_user() and updated_by = auth.uid());

drop policy if exists lead_issues_delete on public.lead_issues;
create policy lead_issues_delete on public.lead_issues
  for delete to authenticated
  using (public.is_directeur());

-- ── agenda ───────────────────────────────────────────────────────
drop policy if exists agenda_select on public.agenda;
create policy agenda_select on public.agenda
  for select to authenticated
  using (public.is_active_user());

drop policy if exists agenda_insert on public.agenda;
create policy agenda_insert on public.agenda
  for insert to authenticated
  with check (public.is_active_user() and owner_id = auth.uid());

drop policy if exists agenda_update on public.agenda;
create policy agenda_update on public.agenda
  for update to authenticated
  using (owner_id = auth.uid() or public.is_directeur())
  with check (owner_id = auth.uid() or public.is_directeur());

drop policy if exists agenda_delete on public.agenda;
create policy agenda_delete on public.agenda
  for delete to authenticated
  using (owner_id = auth.uid() or public.is_directeur());
