# Arrow CRM

Application de prospection de l'agence : 14 028 leads, qualification par
température, suivi des appels et des rendez-vous, agenda partagé.

## Ce que c'est

Une application web servie en statique, adossée à une base Postgres
(Supabase). L'accès se fait par identifiant et mot de passe, sur comptes créés par
la direction. Aucune donnée de prospection n'est accessible sans compte,
et l'application n'envoie aucun email.

- `app/` — l'application (le répertoire publié)
- `supabase/migrations/` — le schéma, les règles d'accès et l'API
- `scripts/` — build et import des leads
- `docs/` — mise en ligne et sécurité

## Reprendre le projet

Si tu arrives sur ce dépôt sans contexte, lis
[docs/ETAT-DU-PROJET.md](docs/ETAT-DU-PROJET.md) en entier avant toute
modification : état de la mise en ligne, décisions structurantes, bugs
déjà corrigés à ne pas réintroduire, et pièges de l'environnement.

## Architecture

```
Navigateur ── mot de passe ──▶ Supabase Auth
     │
     └── requêtes filtrées ──▶ Postgres + Row Level Security
                                 ├─ leads         (lecture seule)
                                 ├─ lead_notes    (chacun écrit les siennes)
                                 ├─ lead_issues   (statut partagé)
                                 └─ agenda        (chacun gère ses RDV)
```

Points structurants :

- **Les leads ne quittent jamais la base en bloc.** Chaque onglet
  demande une page de 50 lignes, filtrée et triée en SQL
  (`search_leads_v2`). Un fichier de prospection servi en statique serait
  téléchargeable par n'importe qui connaissant son URL.
- **La liste des leads est l'accueil.** Secteurs et issues téléphone/RDV
  se combinent en base. Les filtres et la pagination restent dans l'URL.
- **Le SDK Supabase est embarqué au build.** Chart.js n'est plus chargé.
  La police DM Sans est servie par Google Fonts avec une police de secours.
- **Aucun script inline, aucun attribut `onclick`.** Les événements
  utilisent `addEventListener`, ce qui permet une CSP en `script-src 'self'`.
  Les données sont affichées avec des noeuds texte, sans `innerHTML`.

La refonte du 17 septembre est décrite dans [docs/REFONTE.md](docs/REFONTE.md).
Ce complément remplace les descriptions de l'ancien écran dans le document de passation.

## Démarrer en local

```bash
cp .env.example .env      # renseigner SUPABASE_URL et SUPABASE_ANON_KEY
npm install
npm run dev               # build + serveur local sur http://localhost:5173
```

`npm run build` génère `app/config.js` et `app/vendor/`. Ces fichiers
ne sont pas versionnés : ils dépendent de l'environnement.

## Tests

```bash
npm run test:db      # règles d'accès, sur un Postgres local
npm run test:import  # transformation des leads
npm run test:app     # navigateur, page servie avec sa CSP réelle
```

`npm test` inclut les filtres et le parcours commercial connecté sur données simulées.
`test:db` demande un Postgres 16 local, `test:app`
un Chromium (`npx playwright install chromium`).

## Importer les leads

```bash
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run import-leads
```

Idempotent : relancer réimporte par-dessus. La clé de service contourne
RLS et ne doit jamais sortir de ta machine.

## Rôles

| Rôle | Leads | Notes | Agenda |
|---|---|---|---|
| `commercial` | lit tout | lit tout, écrit et supprime les siennes | lit tout, gère les siens |
| `directeur` | lit tout | lit tout, corrige et supprime toutes | lit tout, gère tous |

Les statuts téléphone et rendez-vous sont partagés : c'est l'état
courant du lead pour l'agence, tout commercial actif peut le poser.

Un compte désactivé (`active = false`) perd tout accès et conserve son
historique.

## Mise en ligne

Voir [docs/DEPLOIEMENT.md](docs/DEPLOIEMENT.md).

## Sécurité

Voir [docs/SECURITE.md](docs/SECURITE.md), en particulier la rotation
des clés et la purge de l'historique Git.
