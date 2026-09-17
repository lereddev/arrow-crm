# Refonte du 17 septembre 2026

## Parcours

Leads est l'accueil. Secteurs: Avignon (84/13/30/34/26), Corse (20),
Réunion (974), Lyonnais (69/01/38/42), Alpes-Côte d'Azur (06/83/04).
Ces regroupements ne modifient pas les départements importés. Les éventuels
départements absents ou mal importés restent accessibles dans Tous.

Les issues téléphone et RDV sont les valeurs saisies dans `lead_issues`,
pas le statut historique importé. Ce dernier possède un filtre distinct
dans Plus de filtres. Non renseigné inclut les leads sans ligne de suivi.

URL: `sector`, `q`, `tel`, `rdv`, `priority`, `profession`, `commercial`,
`dept`, `status`, `sort`, `page`. `lead` ouvre une fiche, `view=agenda`
ouvre le planning, `agendaPage` conserve sa pagination.

Notes, suivi et RDV sont toujours dans les tables existantes sous RLS.
L'interface n'efface pas les notes. Un RDV peut être terminé puis réactivé.
Les saisies non enregistrées déclenchent un avertissement avant une navigation
via les boutons ou la fermeture de page. Elles ne sont pas un brouillon sauvegardé.

## Modules

`app.js`: session et navigation. `modules/data.js`: SDK et opérations persistantes.
`filters.js`: filtres et URL. `leads.js`: recherche paginée. `detail.js`: fiche
et notes. `appointments.js`: création et suivi RDV. `agenda.js`: planning.
`ui.js`: composants DOM sans injection HTML. CSS séparée pour le responsive.

## Déploiement ordonné

1. Tests CI au vert, incluant `npm run test:db` sur une base Postgres éphémère.
2. Sauvegarder les définitions existantes avant intervention en production.
3. Appliquer le fichier versionné `0004_lead_explorer.sql`, dans sa transaction.
   Il ajoute deux fonctions SECURITY INVOKER; aucune modification de table,
   de policy ou de donnée. L'API précédente reste disponible.
4. Déployer le frontend seulement après la migration, puis vérifier l'accès.

Retour arrière: redéployer le frontend précédent (commit 35cd9d7).
Les nouvelles fonctions peuvent rester présentes; l'ancien frontend ne les utilise pas.
Ne pas rejouer les migrations 0001-0003 et ne pas réimporter les leads.

## Vérification

Les tests navigateur connectés utilisent uniquement des sociétés fictives et
un backend simulé, jamais un compte production. Ils couvrent pagination, filtres,
notes distinctes, rafraîchissement, erreur d'enregistrement, suivi, agenda et mobile.
Les tests SQL vérifient séparément les permissions réelles des rôles Postgres.
Une validation navigateur simulée n'est pas une preuve d'écriture en production.
