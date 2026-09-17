-- Historical appointments imported from Arrow workbooks. The browser can only
-- read them; imports run through an administrative SQL session or service key.
begin;

create table public.rdv_history (
  id                 uuid primary key,
  source_key         text not null unique,
  lead_id            bigint not null references public.leads(id) on delete cascade,
  occurred_on        date,
  date_rdv_text      text,
  commercial         text,
  confirmation_rdv   text,
  issue_rdv          text not null default '',
  note_issue_rdv     text not null default '',
  source_period      text not null,
  imported_at        timestamptz not null default now(),
  check (length(source_key) between 1 and 200),
  check (length(note_issue_rdv) <= 20000)
);

create table public.rdv_signals (
  rdv_id       uuid not null references public.rdv_history(id) on delete cascade,
  kind         text not null check (kind in ('need', 'blocker')),
  label        text not null check (length(label) between 1 and 80),
  confidence   text not null check (confidence in ('confirmed', 'suggested')),
  rule_version smallint not null default 1,
  primary key (rdv_id, kind, label)
);

-- Locked staging area for a one-off CSV upload from the Supabase dashboard.
-- It is never granted to the application and is emptied atomically after import.
create table public.rdv_import_staging (
  id               uuid primary key,
  source_key       text not null unique,
  siren            text not null,
  occurred_on      date,
  date_rdv_text    text,
  commercial       text,
  confirmation_rdv text,
  issue_rdv        text not null default '',
  note_issue_rdv   text not null default '',
  source_period    text not null,
  signals          jsonb not null default '[]'::jsonb check (jsonb_typeof(signals) = 'array')
);

create index rdv_history_lead_date_idx on public.rdv_history (lead_id, occurred_on desc, id);
create index rdv_history_issue_idx on public.rdv_history (issue_rdv) where issue_rdv <> '';
create index rdv_signals_filter_idx on public.rdv_signals (kind, label, rdv_id);
create index leads_siren_padded_idx on public.leads ((lpad(siren, 9, '0')));

alter table public.rdv_history enable row level security;
alter table public.rdv_signals enable row level security;
alter table public.rdv_import_staging enable row level security;
alter table public.rdv_history force row level security;
alter table public.rdv_signals force row level security;
alter table public.rdv_import_staging force row level security;

revoke all on public.rdv_history, public.rdv_signals, public.rdv_import_staging from public, anon, authenticated;
grant select on public.rdv_history, public.rdv_signals to authenticated;

create policy rdv_history_select on public.rdv_history
  for select to authenticated using (public.is_active_user());
create policy rdv_signals_select on public.rdv_signals
  for select to authenticated using (public.is_active_user());

create or replace function public.finalize_rdv_import()
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_history integer;
  v_signals integer;
begin
  if exists (
    select 1 from public.rdv_import_staging staging
    left join public.leads lead on lpad(lead.siren, 9, '0') = staging.siren
    where lead.id is null
  ) then
    raise exception 'Import interrompu : au moins un SIREN ne correspond à aucun lead';
  end if;

  insert into public.rdv_history (
    id, source_key, lead_id, occurred_on, date_rdv_text, commercial,
    confirmation_rdv, issue_rdv, note_issue_rdv, source_period
  )
  select staging.id, staging.source_key, lead.id, staging.occurred_on,
    staging.date_rdv_text, staging.commercial, staging.confirmation_rdv,
    staging.issue_rdv, staging.note_issue_rdv, staging.source_period
  from public.rdv_import_staging staging
  join public.leads lead on lpad(lead.siren, 9, '0') = staging.siren
  on conflict (source_key) do update set
    occurred_on = excluded.occurred_on,
    date_rdv_text = excluded.date_rdv_text,
    commercial = excluded.commercial,
    confirmation_rdv = excluded.confirmation_rdv,
    issue_rdv = excluded.issue_rdv,
    note_issue_rdv = excluded.note_issue_rdv,
    source_period = excluded.source_period;
  get diagnostics v_history = row_count;

  delete from public.rdv_signals signal
  using public.rdv_import_staging staging
  where signal.rdv_id = staging.id;

  insert into public.rdv_signals (rdv_id, kind, label, confidence, rule_version)
  select staging.id, signal->>'kind', signal->>'label', signal->>'confidence', 1
  from public.rdv_import_staging staging
  cross join lateral jsonb_array_elements(staging.signals) signal;
  get diagnostics v_signals = row_count;

  delete from public.rdv_import_staging;
  return jsonb_build_object('appointments', v_history, 'signals', v_signals);
end;
$$;

revoke all on function public.finalize_rdv_import() from public, anon, authenticated;

create or replace function public.search_leads_v3(
  p_departments smallint[] default null,
  p_excluded_departments smallint[] default null,
  p_departement smallint default null,
  p_search text default null,
  p_priorite text default null,
  p_issue_tel text default null,
  p_issue_rdv text default null,
  p_historical_issue text default null,
  p_need text default null,
  p_blocker text default null,
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
      and (p_excluded_departments is null or l.departement is null or not (l.departement = any(p_excluded_departments)))
      and (p_departement is null or l.departement = p_departement)
      and (nullif(btrim(p_search), '') is null or l.search_text like '%' || lower(btrim(p_search)) || '%')
      and (p_priorite is null or l.priorite = p_priorite)
      and (p_profession is null or l.profession = p_profession)
      and (p_commercial is null or l.commercial = p_commercial)
      and (p_statut is null or l.statut = p_statut)
      and (p_issue_tel is null or coalesce(i.issue_tel, '') = case when p_issue_tel = '__empty' then '' else p_issue_tel end)
      and (p_issue_rdv is null or coalesce(i.issue_rdv, '') = case when p_issue_rdv = '__empty' then '' else p_issue_rdv end)
      and (p_historical_issue is null or exists (
        select 1 from public.rdv_history h where h.lead_id = l.id and
          coalesce(h.issue_rdv, '') = case when p_historical_issue = '__empty' then '' else p_historical_issue end))
      and (p_need is null or exists (
        select 1 from public.rdv_history h join public.rdv_signals s on s.rdv_id = h.id
        where h.lead_id = l.id and s.kind = 'need' and s.label = p_need))
      and (p_blocker is null or exists (
        select 1 from public.rdv_history h join public.rdv_signals s on s.rdv_id = h.id
        where h.lead_id = l.id and s.kind = 'blocker' and s.label = p_blocker))
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
  ), enriched as (
    select p.*, h.id as historical_id, h.occurred_on as historical_date,
      h.date_rdv_text as historical_date_text, h.issue_rdv as historical_issue,
      h.note_issue_rdv as historical_note,
      coalesce((select jsonb_agg(jsonb_build_object('label', s.label, 'confidence', s.confidence) order by s.label)
        from public.rdv_signals s where s.rdv_id = h.id and s.kind = 'need'), '[]'::jsonb) as needs,
      coalesce((select jsonb_agg(jsonb_build_object('label', s.label, 'confidence', s.confidence) order by s.label)
        from public.rdv_signals s where s.rdv_id = h.id and s.kind = 'blocker'), '[]'::jsonb) as blockers
    from page p
    left join lateral (
      select candidate.* from public.rdv_history candidate
      where candidate.lead_id = p.id
      order by
        (p_historical_issue is not null and candidate.issue_rdv = case when p_historical_issue = '__empty' then '' else p_historical_issue end) desc,
        (p_need is not null and exists (select 1 from public.rdv_signals s where s.rdv_id = candidate.id and s.kind = 'need' and s.label = p_need)) desc,
        (p_blocker is not null and exists (select 1 from public.rdv_signals s where s.rdv_id = candidate.id and s.kind = 'blocker' and s.label = p_blocker)) desc,
        candidate.occurred_on desc nulls last, candidate.source_key desc
      limit 1
    ) h on true
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered),
    'rows', coalesce((select jsonb_agg(to_jsonb(e) - 'ordinal' - 'date_rdv_date' || jsonb_build_object(
      'note_count', (select count(*) from public.lead_notes notes where notes.lead_id = e.id)) order by e.ordinal)
      from enriched e), '[]'::jsonb)
  );
$$;

revoke all on function public.search_leads_v3(smallint[],smallint[],smallint,text,text,text,text,text,text,text,text,text,text,text,integer,integer) from public, anon;
grant execute on function public.search_leads_v3(smallint[],smallint[],smallint,text,text,text,text,text,text,text,text,text,text,text,integer,integer) to authenticated;

create or replace function public.lead_filter_options_v3()
returns jsonb
language sql stable security invoker
set search_path = public, pg_temp
as $$
  select public.lead_filter_options_v2() || jsonb_build_object(
    'historical_issue', coalesce((select jsonb_agg(x.issue_rdv order by x.issue_rdv)
      from (select distinct issue_rdv from public.rdv_history where issue_rdv <> '') x), '[]'::jsonb),
    'need', coalesce((select jsonb_agg(x.label order by x.label)
      from (select distinct label from public.rdv_signals where kind = 'need') x), '[]'::jsonb),
    'blocker', coalesce((select jsonb_agg(x.label order by x.label)
      from (select distinct label from public.rdv_signals where kind = 'blocker') x), '[]'::jsonb)
  );
$$;

revoke all on function public.lead_filter_options_v3() from public, anon;
grant execute on function public.lead_filter_options_v3() to authenticated;

commit;
