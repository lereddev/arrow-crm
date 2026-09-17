begin;

insert into public.rdv_history (
  id, source_key, lead_id, occurred_on, date_rdv_text, issue_rdv, note_issue_rdv, source_period
) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'test-rdv-1', 1, '2024-01-12', 'Ven. 12 janvier', 'Réalisé', 'Souhaite une fiche Google.', '2024 T1'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'test-rdv-2', 2, '2024-02-02', 'Ven. 2 février', 'Refus', 'Budget trop faible.', '2024 T1');
insert into public.rdv_signals (rdv_id, kind, label, confidence) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'need', 'GMB', 'confirmed'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'blocker', 'Budget', 'confirmed');

set role anon;
select t.check_denied('anon cannot read historical appointments', $$select count(*) from public.rdv_history$$);
select t.check_denied('anon cannot read historical signals', $$select count(*) from public.rdv_signals$$);
select t.check_denied('anon cannot read import staging', $$select count(*) from public.rdv_import_staging$$);
select t.check_denied('anon cannot call explorer v3', $$select public.search_leads_v3()$$);
reset role;

set role authenticated;
select t.login('22222222-2222-2222-2222-222222222222');
select t.check('active users read all historical appointments', (select count(*) from public.rdv_history) = 2);
select t.check('need filter finds GMB lead', (public.search_leads_v3(p_need => 'GMB')->>'total')::int = 1);
select t.check('blocker filter finds budget lead', (public.search_leads_v3(p_blocker => 'Budget')->>'total')::int = 1);
select t.check('historical issue filter works', (public.search_leads_v3(p_historical_issue => 'Réalisé')->>'total')::int = 1);
select t.check('historical note is returned in list', public.search_leads_v3(p_need => 'GMB')->'rows'->0->>'historical_note' = 'Souhaite une fiche Google.');
select t.check('historical signals accompany the note', public.search_leads_v3(p_need => 'GMB')->'rows'->0->'needs' @> '[{"label":"GMB","confidence":"confirmed"}]'::jsonb);
select t.check('other territories exclude every named department', (public.search_leads_v3(p_excluded_departments => array[1,4,6,13,20,26,30,34,38,42,69,83,84,974]::smallint[])->>'total')::int = 1);
select t.check_denied('authenticated users cannot insert history', $$insert into public.rdv_history (id,source_key,lead_id,source_period) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3','forbidden',1,'test')$$);
select t.check_denied('authenticated users cannot update history', $$update public.rdv_history set note_issue_rdv = 'changed' where source_key = 'test-rdv-1'$$);
select t.check_denied('authenticated users cannot delete signals', $$delete from public.rdv_signals where label = 'GMB'$$);
select t.check_denied('authenticated users cannot stage imports', $$insert into public.rdv_import_staging (id,source_key,siren,source_period) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3','forbidden','100000001','test')$$);

select t.login('44444444-4444-4444-4444-444444444444');
select t.check('disabled users read no history', (select count(*) from public.rdv_history) = 0);
select t.check('disabled users get no v3 records', (public.search_leads_v3()->>'total')::int = 0);

reset role;
select label, detail from t.results where not ok;
do $$ begin
  if exists(select 1 from t.results where not ok) then raise exception 'RDV history security tests failed'; end if;
end $$;
rollback;
