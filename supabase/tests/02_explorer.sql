begin;
insert into public.leads(id,siren,societe,departement,priorite,profession,commercial)
select 100 + n, 'explorer-' || n, 'Explorer ' || lpad(n::text,3,'0'),
  case when n = 61 then 20 when n = 62 then 974 when n = 63 then 69 when n = 64 then 6 when n = 65 then 4 else 84 end,
  case when n % 2 = 0 then '🔥 Chaud' else '⭐ Tiède' end, 'Test métier', 'Test commercial'
from generate_series(1,65) n;
insert into public.lead_issues(lead_id,issue_tel,issue_rdv,updated_by) values
  (101,'À rappeler','Signé','22222222-2222-2222-2222-222222222222'),
  (102,'À rappeler','','22222222-2222-2222-2222-222222222222');

set role anon;
select t.check_denied('anon cannot call explorer', $$select public.search_leads_v2()$$);
select t.check_denied('anon cannot call filter options v2', $$select public.lead_filter_options_v2()$$);
reset role;
set role authenticated;
select t.login('22222222-2222-2222-2222-222222222222');
select t.check('explorer searches across priorities', (public.search_leads_v2(p_search => 'Explorer')->>'total')::int = 65);
select t.check('explorer clamps pages to 50', jsonb_array_length(public.search_leads_v2(p_search => 'Explorer',p_limit => 10000)->'rows') = 50);
select t.check('explorer page two has remaining 15', jsonb_array_length(public.search_leads_v2(p_search => 'Explorer',p_offset => 50)->'rows') = 15);
select t.check('explorer preserves count on empty page', (public.search_leads_v2(p_search => 'Explorer',p_offset => 999)->>'total')::int = 65);
select t.check('explorer empty search results', public.search_leads_v2(p_search => 'does-not-exist')->'rows' = '[]'::jsonb);
select t.check('explorer department grouping before paging', (public.search_leads_v2(p_search => 'Explorer',p_departments => array[84,13,30,34,26]::smallint[])->>'total')::int = 60);
select t.check('explorer Corsica', (public.search_leads_v2(p_search => 'Explorer',p_departments => array[20]::smallint[])->>'total')::int = 1);
select t.check('explorer Reunion', (public.search_leads_v2(p_search => 'Explorer',p_departments => array[974]::smallint[])->>'total')::int = 1);
select t.check('explorer Lyon', (public.search_leads_v2(p_search => 'Explorer',p_departments => array[69,1,38,42]::smallint[])->>'total')::int = 1);
select t.check('explorer Alpes', (public.search_leads_v2(p_search => 'Explorer',p_departments => array[6,83,4]::smallint[])->>'total')::int = 2);
select t.check('explorer intersects sector and department', (public.search_leads_v2(p_search => 'Explorer',p_departments => array[84]::smallint[],p_departement => 6::smallint)->>'total')::int = 0);
select t.check('explorer telephone issue', (public.search_leads_v2(p_search => 'Explorer',p_issue_tel => 'À rappeler')->>'total')::int = 2);
select t.check('explorer combined issues', (public.search_leads_v2(p_search => 'Explorer',p_issue_tel => 'À rappeler',p_issue_rdv => 'Signé')->>'total')::int = 1);
select t.check('explorer unset issue includes absent row', (public.search_leads_v2(p_search => 'Explorer',p_issue_tel => '__empty')->>'total')::int = 63);
select t.check('explorer unset RDV includes blank and absent rows', (public.search_leads_v2(p_search => 'Explorer',p_issue_rdv => '__empty')->>'total')::int = 64);
select t.check('explorer priorities combined with territory', (public.search_leads_v2(p_search => 'Explorer',p_departments => array[84]::smallint[],p_priorite => '🔥 Chaud')->>'total')::int = 30);
select t.check('explorer sort injection is inert', (public.search_leads_v2(p_search => 'Explorer',p_sort => 'id; drop table public.leads; --')->>'total')::int = 65);
select t.check('explorer negative offset is clamped', (public.search_leads_v2(p_search => 'Explorer',p_offset => -9)->'rows'->0->>'id')::int = 101);
select t.check('explorer second page is stable', (public.search_leads_v2(p_search => 'Explorer',p_offset => 50)->'rows'->0->>'id')::int = 151);
select t.check('filter options contain aggregate labels', public.lead_filter_options_v2()->'profession' @> '["Test métier"]'::jsonb);
select t.login('44444444-4444-4444-4444-444444444444');
select t.check('disabled user gets no explorer records', public.search_leads_v2()->'rows' = '[]'::jsonb);
select t.check('disabled user gets no explorer count', (public.search_leads_v2()->>'total')::int = 0);
select t.check('disabled user gets no filter information', public.lead_filter_options_v2()->'profession' = '[]'::jsonb);
select t.logout();
select t.check('authenticated role without identity gets no data', (public.search_leads_v2()->>'total')::int = 0);
reset role;
select label, detail from t.results where not ok;
select count(*) filter (where ok) as reussis, count(*) filter (where not ok) as echecs, count(*) as total from t.results;
do $$ begin
  if exists(select 1 from t.results where not ok) then raise exception 'Explorer security tests failed'; end if;
end $$;
rollback;
