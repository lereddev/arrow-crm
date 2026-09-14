-- ═══════════════════════════════════════════════════════════════
-- Tests des règles d'accès.
--
-- L'application n'a pas de serveur applicatif : ces policies SONT la
-- sécurité. Chaque test vérifie qu'un utilisateur ne peut pas faire
-- ce qu'il ne doit pas faire, en forgeant la requête directement —
-- c'est-à-dire exactement ce que ferait quelqu'un qui contourne
-- l'interface.
-- ═══════════════════════════════════════════════════════════════

truncate t.results;

-- ── Jeu d'essai ─────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'directeur@exemple.fr'),
  ('22222222-2222-2222-2222-222222222222', 'commercial@exemple.fr'),
  ('33333333-3333-3333-3333-333333333333', 'autre@exemple.fr'),
  ('44444444-4444-4444-4444-444444444444', 'parti@exemple.fr');

update public.app_users set role = 'directeur'
  where id = '11111111-1111-1111-1111-111111111111';
update public.app_users set active = false
  where id = '44444444-4444-4444-4444-444444444444';

insert into public.leads (id, siren, societe, ville, profession, commercial, priorite, statut, departement, nb_rdvs, nb_audits)
values
  (1, '100000001', 'MS Carrosserie',  'SAINT-RAPHAEL', 'Garage',     'G.Gay',        '🔥 Chaud', 'Confirmé', 83, 5, 1),
  (2, '100000002', 'Boulangerie Sud', 'AVIGNON',       'Boulanger',  'S.Chevallier', '🔥 Chaud', 'Confirmé', 84, 2, 0),
  (3, '100000003', 'Plomberie Nord',  'ANNEMASSE',     'Plombier',   'G.Gay',        '⭐ Tiède', 'Lapin',    74, 1, 0);

-- Le trigger a-t-il bien créé un profil par compte invité ?
select t.check('un profil applicatif est créé à l''invitation',
  (select count(*) from public.app_users) = 4);

-- ═══ Rôle anonyme : rien ne doit filtrer ═══
set role anon;

-- Les droits sont révoqués pour anon : la requête est refusée avant
-- même que RLS n'ait à filtrer. Deux barrières plutôt qu'une.
select t.check_denied('anon ne peut pas lire les leads',
  $$select count(*) from public.leads$$);
select t.check_denied('anon ne peut pas lire les notes',
  $$select count(*) from public.lead_notes$$);
select t.check_denied('anon ne peut pas lire les rendez-vous',
  $$select count(*) from public.agenda$$);
select t.check_denied('anon ne peut pas lire les comptes',
  $$select count(*) from public.app_users$$);
select t.check_denied('anon ne peut pas écrire de note',
  $$insert into public.lead_notes (lead_id, author_id, text)
    values (1, '22222222-2222-2222-2222-222222222222', 'anonyme')$$);
select t.check_denied('anon ne peut pas appeler search_leads',
  $$select * from public.search_leads('🔥 Chaud')$$);

reset role;

-- ═══ Compte désactivé : accès coupé, historique conservé ═══
set role authenticated;
select t.login('44444444-4444-4444-4444-444444444444');

select t.check('un compte désactivé ne lit aucun lead',
  (select count(*) from public.leads) = 0);
select t.check('un compte désactivé ne lit aucun compte',
  (select count(*) from public.app_users) = 0);

-- ═══ Commercial actif ═══
select t.login('22222222-2222-2222-2222-222222222222');

select t.check('un commercial lit tous les leads',
  (select count(*) from public.leads) = 3);
select t.check('un commercial voit les comptes de l''agence',
  (select count(*) from public.app_users) = 4);

-- Les leads sont des données de référence : aucune écriture depuis
-- l'application, quel que soit le rôle.
select t.check_denied('un commercial ne peut pas créer un lead',
  $$insert into public.leads (id, siren, priorite) values (99, '999999999', '🔥 Chaud')$$);
select t.check_denied('un commercial ne peut pas modifier un lead',
  $$update public.leads set societe = 'pirate' where id = 1$$);
select t.check_denied('un commercial ne peut pas supprimer un lead',
  $$delete from public.leads where id = 1$$);

-- Élévation de privilèges : la tentative la plus évidente.
select t.check_denied('un commercial ne peut pas se nommer directeur',
  $$update public.app_users set role = 'directeur'
    where id = '22222222-2222-2222-2222-222222222222'$$);
-- RLS refuse en filtrant : la requête aboutit, mais ne porte sur
-- aucune ligne. C'est l'état final qui fait foi, pas l'absence
-- d'erreur.
update public.app_users set active = true
  where id = '44444444-4444-4444-4444-444444444444';
select t.check('réactiver un accès coupé reste sans effet pour un commercial',
  (select active from public.app_users
   where id = '44444444-4444-4444-4444-444444444444') = false);
select t.check_denied('un commercial ne peut pas se rattacher à un autre portefeuille',
  $$update public.app_users set commercial_code = 'G.Gay'
    where id = '22222222-2222-2222-2222-222222222222'$$);

-- En revanche il corrige son propre nom.
update public.app_users set nom = 'Commercial Test'
  where id = '22222222-2222-2222-2222-222222222222';
select t.check('un commercial corrige son propre nom',
  (select nom from public.app_users where id = '22222222-2222-2222-2222-222222222222') = 'Commercial Test');

-- ── Notes ──
insert into public.lead_notes (lead_id, author_id, text)
  values (1, '22222222-2222-2222-2222-222222222222', 'Rappelé, intéressé.');
select t.check('un commercial écrit une note en son nom',
  (select count(*) from public.lead_notes) = 1);

select t.check_denied('un commercial ne peut pas signer une note au nom d''un autre',
  $$insert into public.lead_notes (lead_id, author_id, text)
    values (1, '33333333-3333-3333-3333-333333333333', 'note usurpée')$$);

-- ── Statuts ──
insert into public.lead_issues (lead_id, issue_tel, issue_rdv, updated_by)
  values (1, 'À rappeler', '', '22222222-2222-2222-2222-222222222222');
select t.check('un commercial pose un statut partagé',
  (select issue_tel from public.lead_issues where lead_id = 1) = 'À rappeler');

select t.check_denied('un statut ne peut pas être attribué à un autre compte',
  $$insert into public.lead_issues (lead_id, issue_tel, updated_by)
    values (2, 'Injoignable', '33333333-3333-3333-3333-333333333333')$$);

-- ── Agenda ──
insert into public.agenda (lead_id, owner_id, societe, date_rdv)
  values (1, '22222222-2222-2222-2222-222222222222', 'MS Carrosserie', current_date + 3);
select t.check('un commercial planifie son rendez-vous',
  (select count(*) from public.agenda) = 1);

select t.check_denied('un rendez-vous ne peut pas être créé au nom d''un autre',
  $$insert into public.agenda (lead_id, owner_id, societe, date_rdv)
    values (2, '33333333-3333-3333-3333-333333333333', 'Boulangerie Sud', current_date + 4)$$);

-- ═══ Un autre commercial : lecture partagée, écriture bornée ═══
select t.login('33333333-3333-3333-3333-333333333333');

select t.check('les notes des collègues sont lisibles',
  (select count(*) from public.lead_notes) = 1);
select t.check('l''agenda de l''agence est lisible',
  (select count(*) from public.agenda) = 1);

-- La policy DELETE filtre : la suppression ne lève pas d'erreur, elle
-- ne porte simplement sur aucune ligne. C'est le comportement voulu.
delete from public.lead_notes where author_id = '22222222-2222-2222-2222-222222222222';
select t.check('un commercial ne supprime pas la note d''un collègue',
  (select count(*) from public.lead_notes) = 1);

delete from public.agenda;
select t.check('un commercial ne supprime pas le rendez-vous d''un collègue',
  (select count(*) from public.agenda) = 1);

update public.lead_notes set text = 'réécrite' where lead_id = 1;
select t.check('un commercial ne réécrit pas la note d''un collègue',
  (select text from public.lead_notes where lead_id = 1) = 'Rappelé, intéressé.');

-- Le statut, lui, est partagé : il doit pouvoir le corriger.
update public.lead_issues
  set issue_tel = 'Injoignable', updated_by = '33333333-3333-3333-3333-333333333333'
  where lead_id = 1;
select t.check('un statut partagé est corrigeable par tout commercial',
  (select issue_tel from public.lead_issues where lead_id = 1) = 'Injoignable');

-- ═══ Directeur ═══
select t.login('11111111-1111-1111-1111-111111111111');

update public.app_users set role = 'directeur'
  where id = '33333333-3333-3333-3333-333333333333';
select t.check('un directeur promeut un commercial',
  (select role from public.app_users where id = '33333333-3333-3333-3333-333333333333') = 'directeur');

update public.app_users set active = false
  where id = '33333333-3333-3333-3333-333333333333';
select t.check('un directeur coupe un accès',
  (select active from public.app_users where id = '33333333-3333-3333-3333-333333333333') = false);

delete from public.lead_notes where lead_id = 1;
select t.check('un directeur supprime la note d''un commercial',
  (select count(*) from public.lead_notes) = 0);

select t.check_denied('un directeur ne peut pas davantage modifier un lead',
  $$update public.leads set societe = 'pirate' where id = 1$$);

-- ═══ Recherche paginée ═══
select t.login('22222222-2222-2222-2222-222222222222');

select t.check('search_leads filtre par température',
  (select count(*) from public.search_leads('🔥 Chaud')) = 2);
select t.check('search_leads remonte le total avec la page',
  (select distinct total_count from public.search_leads('🔥 Chaud')) = 2);
select t.check('la recherche est insensible à la casse et cherche en sous-chaîne',
  (select count(*) from public.search_leads('🔥 Chaud', 'carross')) = 1);
select t.check('la recherche porte aussi sur la ville',
  (select count(*) from public.search_leads('🔥 Chaud', 'avignon')) = 1);
select t.check('la recherche porte aussi sur le SIREN',
  (select count(*) from public.search_leads('🔥 Chaud', '100000002')) = 1);
select t.check('le filtre département s''applique',
  (select count(*) from public.search_leads('🔥 Chaud', null, 83::smallint)) = 1);
select t.check('le filtre commercial s''applique',
  (select count(*) from public.search_leads('🔥 Chaud', null, null, null, 'G.Gay')) = 1);
select t.check('le tri décroissant sur société est appliqué',
  (select societe from public.search_leads('🔥 Chaud', null, null, null, null, null, 'societe', 'desc', 1, 0)) = 'MS Carrosserie');
select t.check('la pagination décale bien la fenêtre',
  (select societe from public.search_leads('🔥 Chaud', null, null, null, null, null, 'societe', 'asc', 1, 1)) = 'MS Carrosserie');
select t.check('les statuts accompagnent la ligne',
  (select issue_tel from public.search_leads('🔥 Chaud', 'carross')) = 'Injoignable');

-- Une colonne de tri inconnue ne doit jamais atteindre le plan de
-- requête : elle retombe sur le tri par défaut.
select t.check('un tri inconnu retombe sur le tri par défaut',
  (select count(*) from public.search_leads('🔥 Chaud', null, null, null, null, null, 'colonne_inexistante')) = 2);
-- La liste blanche ne rejette pas, elle ignore : une valeur inconnue
-- n'atteint jamais le plan de requête et le tri par défaut s'applique.
select t.check('une chaîne malveillante dans le tri est ignorée',
  (select count(*) from public.search_leads('🔥 Chaud', null, null, null, null, null,
      'societe; drop table public.leads; --')) = 2);
select t.check('la table leads est intacte après la tentative',
  (select count(*) from public.leads) = 3);

-- Une limite démesurée est bornée, pas honorée telle quelle.
select t.check('la taille de page est plafonnée',
  (select count(*) from public.search_leads('🔥 Chaud', null, null, null, null, null, null, 'asc', 100000, 0)) = 2);

-- ═══ Agrégats ═══
select t.check('les agrégats par température sont exacts',
  (select n from public.v_stats_priorite where priorite = '🔥 Chaud') = 2);
select t.check('les agrégats comptent les leads chauds par département',
  (select n_chaud from public.v_stats_departement where departement = 83) = 1);
select t.check('les totaux du tableau de bord sont exacts',
  (select total_leads from public.dashboard_totals()) = 3);

-- Les vues passent par les droits de l'appelant, pas ceux de leur
-- propriétaire : un compte coupé ne doit obtenir aucune statistique.
select t.login('44444444-4444-4444-4444-444444444444');
select t.check('un compte désactivé n''obtient aucun agrégat',
  (select coalesce(sum(n), 0) from public.v_stats_priorite) = 0);
select t.check('un compte désactivé n''obtient aucun total',
  (select total_leads from public.dashboard_totals()) = 0);

reset role;
select t.logout();

-- ── Verdict ─────────────────────────────────────────────────────
select label, case when ok then 'OK' else 'ECHEC' end as resultat, detail
from t.results where not ok order by id;

select count(*) filter (where ok)     as reussis,
       count(*) filter (where not ok) as echecs,
       count(*)                       as total
from t.results;

do $$
declare n integer;
begin
  select count(*) into n from t.results where not ok;
  if n > 0 then
    raise exception '% test(s) de securite en echec', n;
  end if;
end
$$;
