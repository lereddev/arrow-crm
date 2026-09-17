-- Additive API: the existing production client remains compatible during rollout.
-- No table writes, no policy changes; all reads use the caller's RLS permissions.
begin;

create or replace function public.search_leads_v2(
  p_departments smallint[] default null,
  p_departement smallint default null,
  p_search text default null,
  p_priorite text default null,
  p_issue_tel text default null,
  p_issue_rdv text default null,
  p_profession text default null,
  p_commercial text default null,
  p_statut text default null,
  p_sort text default 'societe',
  p_offset integer default 0,
  p_limit integer default 50
)
returns jsonb
language sql stable security invoker
set search_path = public, pg_temp
as $$
  with filtered as materialized (
    select l.id, l.societe, l.profession, l.departement, l.ville, l.telephone,
      l.priorite, l.commercial, l.date_rdv_date, l.nb_rdvs,
      coalesce(i.issue_tel, '') as issue_tel, coalesce(i.issue_rdv, '') as issue_rdv
    from public.leads l
    left join public.lead_issues i on i.lead_id = l.id
    where (p_departments is null or l.departement = any(p_departments))
      and (p_departement is null or l.departement = p_departement)
      and (nullif(btrim(p_search), '') is null or l.search_text like '%' || lower(btrim(p_search)) || '%')
      and (p_priorite is null or l.priorite = p_priorite)
      and (p_profession is null or l.profession = p_profession)
      and (p_commercial is null or l.commercial = p_commercial)
      and (p_statut is null or l.statut = p_statut)
      and (p_issue_tel is null or coalesce(i.issue_tel, '') = case when p_issue_tel = '__empty' then '' else p_issue_tel end)
      and (p_issue_rdv is null or coalesce(i.issue_rdv, '') = case when p_issue_rdv = '__empty' then '' else p_issue_rdv end)
  ), numbered as (
    select f.*, row_number() over (order by
      case when p_sort = 'priorite' then case f.priorite
        when '🔥 Chaud' then 1 when '⭐ Tiède' then 2 when '❄️ Froid' then 3 when '🔄 Client' then 4 else 5 end end,
      case when p_sort = 'ville' then f.ville end asc nulls last,
      case when p_sort = 'date_rdv' then f.date_rdv_date end desc nulls last,
      case when p_sort = 'nb_rdvs' then f.nb_rdvs end desc nulls last,
      f.societe asc nulls last, f.id asc) as ordinal
    from filtered f
  ), page as (
    select n.* from numbered n order by ordinal
    limit least(greatest(coalesce(p_limit, 50), 1), 50)
    offset greatest(coalesce(p_offset, 0), 0)
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered),
    'rows', coalesce((select jsonb_agg(
      (to_jsonb(p) - 'ordinal' - 'date_rdv_date') || jsonb_build_object('note_count',
        (select count(*) from public.lead_notes notes where notes.lead_id = p.id))
      order by p.ordinal) from page p), '[]'::jsonb)
  );
$$;

revoke all on function public.search_leads_v2(smallint[],smallint,text,text,text,text,text,text,text,text,integer,integer) from public, anon;
grant execute on function public.search_leads_v2(smallint[],smallint,text,text,text,text,text,text,text,text,integer,integer) to authenticated;

create or replace function public.lead_filter_options_v2()
returns jsonb
language sql stable security invoker
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'departement', coalesce((select jsonb_agg(d.departement::text order by d.departement)
      from (select distinct departement from public.leads where departement is not null) d), '[]'::jsonb),
    'profession', coalesce((select jsonb_agg(p.profession order by p.profession)
      from (select distinct profession from public.leads where nullif(profession, '') is not null) p), '[]'::jsonb),
    'commercial', coalesce((select jsonb_agg(c.commercial order by c.commercial)
      from (select distinct commercial from public.leads where nullif(commercial, '') is not null) c), '[]'::jsonb),
    'statut', coalesce((select jsonb_agg(s.statut order by s.statut)
      from (select distinct statut from public.leads where nullif(statut, '') is not null) s), '[]'::jsonb)
  );
$$;
revoke all on function public.lead_filter_options_v2() from public, anon;
grant execute on function public.lead_filter_options_v2() to authenticated;
commit;
