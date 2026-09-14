-- ═══════════════════════════════════════════════════════════════
-- 0003 — Surface d'API : recherche paginée et agrégats du tableau
--        de bord.
--
-- L'application ne télécharge plus les 14 028 leads : elle demande
-- une page de 50 lignes avec ses filtres, et lit des agrégats
-- calculés en base pour le tableau de bord.
-- ═══════════════════════════════════════════════════════════════

-- ── Recherche paginée ────────────────────────────────────────────
-- Reproduit exactement la sémantique de l'ancien filtrage côté
-- navigateur : recherche sous-chaîne sur société, ville, profession,
-- commercial et SIREN, puis filtres exacts, puis tri.
--
-- Le tri est dynamique, donc la colonne est validée contre une liste
-- blanche avant toute interpolation. Une valeur hors liste retombe
-- sur le tri par défaut : aucune chaîne venue du client n'atteint le
-- plan de requête.
create or replace function public.search_leads(
  p_priorite    text,
  p_search      text default null,
  p_departement smallint default null,
  p_profession  text default null,
  p_commercial  text default null,
  p_statut      text default null,
  p_sort        text default null,
  p_dir         text default 'asc',
  p_limit       integer default 50,
  p_offset      integer default 0
)
returns table (
  id               bigint,
  siren            text,
  societe          text,
  profession       text,
  departement      smallint,
  ville            text,
  adresse          text,
  telephone        text,
  priorite         text,
  statut           text,
  date_rdv         text,
  nb_rdvs          integer,
  nb_audits        integer,
  premiere_periode text,
  derniere_periode text,
  commercial       text,
  notes            text,
  lien_arrow       text,
  issue_tel        text,
  issue_rdv        text,
  note_count       bigint,
  total_count      bigint
)
language plpgsql
stable
security invoker
as $$
declare
  v_sort   text;
  v_dir    text;
  v_limit  integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_order  text;
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
begin
  -- Liste blanche des colonnes triables : les en-têtes cliquables du tableau.
  v_sort := case lower(coalesce(p_sort, ''))
    when 'societe'     then 'l.societe'
    when 'profession'  then 'l.profession'
    when 'departement' then 'l.departement'
    when 'ville'       then 'l.ville'
    when 'statut'      then 'l.statut'
    when 'priorite'    then 'l.priorite'
    when 'date_rdv'    then 'l.date_rdv_date'
    when 'nb_rdvs'     then 'l.nb_rdvs'
    when 'nb_audits'   then 'l.nb_audits'
    else null
  end;

  v_dir := case when lower(coalesce(p_dir, 'asc')) = 'desc' then 'desc' else 'asc' end;

  -- `l.id` en tie-breaker : sans ordre total, deux pages successives
  -- peuvent renvoyer deux fois la même ligne et en sauter une autre.
  if v_sort is null then
    v_order := 'l.id asc';
  else
    v_order := v_sort || ' ' || v_dir || ' nulls last, l.id asc';
  end if;

  return query execute format($q$
    select
      l.id, l.siren, l.societe, l.profession, l.departement, l.ville,
      l.adresse, l.telephone, l.priorite, l.statut, l.date_rdv,
      l.nb_rdvs, l.nb_audits, l.premiere_periode, l.derniere_periode,
      l.commercial, l.notes, l.lien_arrow,
      coalesce(i.issue_tel, '') as issue_tel,
      coalesce(i.issue_rdv, '') as issue_rdv,
      coalesce(n.cnt, 0)        as note_count,
      count(*) over ()          as total_count
    from public.leads l
    left join public.lead_issues i on i.lead_id = l.id
    left join lateral (
      select count(*) as cnt from public.lead_notes ln where ln.lead_id = l.id
    ) n on true
    where l.priorite = $1
      and ($2 is null or l.search_text like '%%' || lower($2) || '%%')
      and ($3 is null or l.departement = $3)
      and ($4 is null or l.profession  = $4)
      and ($5 is null or l.commercial  = $5)
      and ($6 is null or l.statut      = $6)
    order by %s
    limit $7 offset $8
  $q$, v_order)
  using p_priorite, v_search, p_departement, p_profession,
        p_commercial, p_statut, v_limit, v_offset;
end;
$$;

revoke all on function public.search_leads(text, text, smallint, text, text, text, text, text, integer, integer) from public, anon;
grant execute on function public.search_leads(text, text, smallint, text, text, text, text, text, integer, integer) to authenticated;

-- ── Valeurs disponibles dans les filtres ─────────────────────────
-- Les menus déroulants d'un onglet ne doivent proposer que ce qui
-- existe réellement pour cette priorité.
create or replace function public.lead_filter_options(p_priorite text)
returns table (kind text, value text, n bigint)
language sql
stable
security invoker
as $$
  select 'departement', d.departement::text, d.n from (
    select departement, count(*) n from public.leads
    where priorite = p_priorite and departement is not null
    group by departement order by departement) d
  union all
  select 'profession', p.profession, p.n from (
    select profession, count(*) n from public.leads
    where priorite = p_priorite and profession is not null
    group by profession order by profession) p
  union all
  select 'commercial', c.commercial, c.n from (
    select commercial, count(*) n from public.leads
    where priorite = p_priorite and commercial is not null
    group by commercial order by commercial) c
  union all
  select 'statut', s.statut, s.n from (
    select statut, count(*) n from public.leads
    where priorite = p_priorite and statut is not null
    group by statut order by statut) s;
$$;

revoke all on function public.lead_filter_options(text) from public, anon;
grant execute on function public.lead_filter_options(text) to authenticated;

-- ── Agrégats du tableau de bord ──────────────────────────────────
-- `security_invoker` fait passer ces vues par les policies de
-- l'appelant : un utilisateur inactif n'obtient aucune ligne, au lieu
-- de statistiques calculées avec les droits du propriétaire de la vue.
create or replace view public.v_stats_priorite
  with (security_invoker = true) as
  select priorite, count(*)::bigint as n
  from public.leads group by priorite order by n desc;

-- `n_chaud` alimente la colonne « % chauds » des tableaux de détail :
-- un département gros en volume mais froid n'est pas une priorité
-- commerciale, et le total seul ne le dit pas.
create or replace view public.v_stats_departement
  with (security_invoker = true) as
  select
    departement,
    count(*)::bigint                                        as n,
    count(*) filter (where priorite = '🔥 Chaud')::bigint    as n_chaud
  from public.leads where departement is not null
  group by departement order by n desc;

create or replace view public.v_stats_profession
  with (security_invoker = true) as
  select
    profession,
    count(*)::bigint                                        as n,
    count(*) filter (where priorite = '🔥 Chaud')::bigint    as n_chaud
  from public.leads where profession is not null
  group by profession order by n desc;

create or replace view public.v_stats_commercial
  with (security_invoker = true) as
  select commercial, count(*)::bigint as n
  from public.leads where commercial is not null
  group by commercial order by n desc;

create or replace view public.v_stats_statut
  with (security_invoker = true) as
  select statut, count(*)::bigint as n
  from public.leads where statut is not null
  group by statut order by n desc;

revoke all on public.v_stats_priorite, public.v_stats_departement,
              public.v_stats_profession, public.v_stats_commercial,
              public.v_stats_statut
  from anon;

grant select on public.v_stats_priorite, public.v_stats_departement,
                public.v_stats_profession, public.v_stats_commercial,
                public.v_stats_statut
  to authenticated;

-- ── Totaux globaux ───────────────────────────────────────────────
create or replace function public.dashboard_totals()
returns table (total_leads bigint, total_rdvs bigint, total_audits bigint, total_agenda bigint)
language sql
stable
security invoker
as $$
  select
    (select count(*) from public.leads),
    (select coalesce(sum(nb_rdvs), 0) from public.leads),
    (select coalesce(sum(nb_audits), 0) from public.leads),
    (select count(*) from public.agenda where not disabled);
$$;

revoke all on function public.dashboard_totals() from public, anon;
grant execute on function public.dashboard_totals() to authenticated;
