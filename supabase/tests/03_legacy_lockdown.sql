-- Reproduce the three permissive prototype tables found in production. The
-- migration must preserve their rows, recover valid activity, and remove all
-- anonymous access.
create table public.crm_notes (
  id uuid primary key,
  siren text not null,
  lead_id integer not null,
  text text not null,
  created_at timestamptz
);
create table public.crm_issues (
  id uuid primary key,
  siren text not null,
  lead_id integer not null,
  issue_tel text,
  issue_rdv text,
  updated_at timestamptz
);
create table public.crm_agenda (
  id uuid primary key,
  siren text not null,
  lead_id integer not null,
  societe text,
  priorite text,
  telephone text,
  commercial text,
  departement text,
  ville text,
  date_rdv date not null,
  heure_rdv text,
  note_rdv text,
  disabled boolean,
  created_at timestamptz
);

alter table public.crm_notes enable row level security;
alter table public.crm_issues enable row level security;
alter table public.crm_agenda enable row level security;
create policy "Allow all" on public.crm_notes for all using (true) with check (true);
create policy "Allow all" on public.crm_issues for all using (true) with check (true);
create policy "Allow all" on public.crm_agenda for all using (true) with check (true);
grant all on public.crm_notes, public.crm_issues, public.crm_agenda to anon, authenticated;

insert into public.crm_notes values (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '100000002', 2,
  'Note historique', '2026-01-10T10:00:00Z'
);
insert into public.crm_issues values (
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '100000002', 2,
  'A rappeler', 'A planifier', '2026-01-11T10:00:00Z'
);
insert into public.crm_agenda values (
  'cccccccc-cccc-cccc-cccc-cccccccccccc', '100000002', 2,
  'Boulangerie Sud', 'Chaud', '0102030405', 'Ancien commercial', '84',
  'AVIGNON', '2026-10-20', '14:00', 'Rendez-vous historique', false,
  '2026-01-12T10:00:00Z'
);

\ir ../migrations/0005_legacy_lockdown.sql

select t.check('legacy note is recovered with its original id and date',
  exists(select 1 from public.lead_notes
    where id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
      and created_at = '2026-01-10T10:00:00Z'));
select t.check('legacy issue is recovered',
  exists(select 1 from public.lead_issues
    where lead_id = 2 and issue_tel = 'A rappeler' and issue_rdv = 'A planifier'));
select t.check('legacy appointment is recovered with its original id',
  exists(select 1 from public.agenda
    where id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
      and note_rdv = 'Rendez-vous historique'));
select t.check('legacy source rows are preserved',
  (select count(*) from public.crm_notes) = 1
  and (select count(*) from public.crm_issues) = 1
  and (select count(*) from public.crm_agenda) = 1);
select t.check('legacy policies are removed',
  not exists(select 1 from pg_policies
    where schemaname = 'public'
      and tablename in ('crm_notes', 'crm_issues', 'crm_agenda')));

set role anon;
select t.check_denied('anon cannot read legacy notes',
  $$select count(*) from public.crm_notes$$);
select t.check_denied('anon cannot write legacy issues',
  $$insert into public.crm_issues (id, siren, lead_id)
    values (gen_random_uuid(), '100000003', 3)$$);
select t.check_denied('anon cannot read legacy agenda',
  $$select count(*) from public.crm_agenda$$);
reset role;

select label, detail from t.results where not ok;
select count(*) filter (where ok) as reussis,
       count(*) filter (where not ok) as echecs,
       count(*) as total
from t.results;

do $$
begin
  if exists(select 1 from t.results where not ok) then
    raise exception 'Legacy lockdown tests failed';
  end if;
end
$$;
