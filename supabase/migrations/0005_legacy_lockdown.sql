-- Recover the small amount of CRM activity left in the original prototype,
-- then make those obsolete tables unreachable. No legacy row is deleted.
begin;

do $$
declare
  v_owner uuid;
  v_table text;
  v_policy record;
begin
  select id into v_owner
  from public.app_users
  where active
  order by (role = 'directeur') desc, created_at, id
  limit 1;

  if to_regclass('public.crm_notes') is not null and v_owner is not null then
    execute $sql$
      insert into public.lead_notes (id, lead_id, author_id, text, created_at)
      select n.id, n.lead_id, $1, n.text, coalesce(n.created_at, now())
      from public.crm_notes n
      join public.leads l on l.id = n.lead_id and l.siren = n.siren
      on conflict (id) do nothing
    $sql$ using v_owner;
  end if;

  if to_regclass('public.crm_issues') is not null then
    execute $sql$
      insert into public.lead_issues (lead_id, issue_tel, issue_rdv, updated_by, updated_at)
      select i.lead_id, coalesce(i.issue_tel, ''), coalesce(i.issue_rdv, ''), null,
        coalesce(i.updated_at, now())
      from public.crm_issues i
      join public.leads l on l.id = i.lead_id and l.siren = i.siren
      on conflict (lead_id) do nothing
    $sql$;
  end if;

  if to_regclass('public.crm_agenda') is not null and v_owner is not null then
    execute $sql$
      insert into public.agenda (
        id, lead_id, owner_id, siren, societe, priorite, telephone, commercial,
        departement, ville, date_rdv, heure_rdv, note_rdv, disabled, created_at
      )
      select a.id, a.lead_id, $1, a.siren, a.societe, a.priorite, a.telephone,
        a.commercial, a.departement, a.ville, a.date_rdv, a.heure_rdv,
        coalesce(a.note_rdv, ''), coalesce(a.disabled, false),
        coalesce(a.created_at, now())
      from public.crm_agenda a
      join public.leads l on l.id = a.lead_id and l.siren = a.siren
      on conflict (id) do nothing
    $sql$ using v_owner;
  end if;

  foreach v_table in array array['crm_notes', 'crm_issues', 'crm_agenda'] loop
    if to_regclass('public.' || v_table) is not null then
      for v_policy in
        select policyname
        from pg_policies
        where schemaname = 'public' and tablename = v_table
      loop
        execute format('drop policy %I on public.%I', v_policy.policyname, v_table);
      end loop;

      execute format('revoke all on table public.%I from public, anon, authenticated', v_table);
      execute format('alter table public.%I enable row level security', v_table);
      execute format('alter table public.%I force row level security', v_table);
    end if;
  end loop;
end
$$;

commit;
