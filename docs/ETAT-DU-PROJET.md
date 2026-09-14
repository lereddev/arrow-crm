# État du projet — reprise de développement

Document de passation. À lire en entier avant toute modification.

Dernière mise à jour : 14 septembre 2026.

---

## 1. Le contexte

Arrow CRM est l'outil de prospection d'une agence commerciale (Avignon,
Vaucluse). Le propriétaire du projet est directeur d'agence : il a des
commerciaux itinérants à sa charge, qui utiliseront l'application depuis
leur téléphone entre deux rendez-vous.

Le fichier de prospection compte **14 028 leads** : raison sociale,
téléphone, adresse, SIREN, profession, département, historique de
rendez-vous, commercial affecté, et des notes commerciales nominatives.
Une partie des leads sont des personnes physiques (entrepreneurs
individuels).

**Conséquence directe sur toute décision technique : ces données sont des
données personnelles au sens du RGPD.** Rien ne doit être accessible sans
authentification, jamais, à aucun moment.

---

## 2. L'état de départ, et pourquoi tout a changé

L'application d'origine était un fichier `index.html` unique servi en
statique, avec `data.json` (10 Mo) à côté, chargé intégralement au
démarrage.

Trois problèmes rédhibitoires :

1. **`data.json` servi en statique est public.** Sur n'importe quel
   hébergement, `curl https://domaine/data.json` renvoyait les 14 028
   fiches. Authentification ou pas.
2. Une clé Supabase était committée en clair dans le dépôt.
3. 10 Mo chargés au démarrage, sur mobile en 4G.

La refonte répond aux trois : les leads vivent en base sous Row Level
Security, l'accès passe par une authentification, et les données
arrivent par pages de 50.

---

## 3. Architecture

```
Navigateur ── mot de passe ──▶ Supabase Auth
     │
     └── requêtes filtrées ──▶ Postgres + Row Level Security
                                 ├─ leads         (lecture seule)
                                 ├─ lead_notes    (chacun écrit les siennes)
                                 ├─ lead_issues   (statut partagé)
                                 ├─ agenda        (chacun gère ses RDV)
                                 └─ app_users     (profils et rôles)
```

**Il n'y a pas de serveur applicatif.** Le client statique parle
directement à PostgREST. La sécurité repose donc *entièrement* sur RLS :
une policy manquante n'est pas une gêne, c'est une fuite de données.

### Choix structurants à ne pas défaire sans raison

| Choix | Pourquoi |
|---|---|
| Application en HTML/CSS/JS sans framework | L'app existait déjà sous cette forme et fonctionne. Une réécriture en React ou Next n'apporterait rien au métier et réintroduirait des régressions. |
| Pagination serveur (`search_leads`) | Un chargement global rendrait les données massivement extractibles et l'app inutilisable sur mobile. |
| Aucune dépendance chargée depuis un CDN à l'exécution | Supabase et Chart.js sont regroupés au build et servis depuis le domaine. Surface d'attaque supply chain réduite, et la CSP peut rester stricte. |
| Aucun `onclick` inline, aucun script inline | Permet `script-src 'self'` dans la CSP. Du code injecté ne s'exécute pas. Les événements passent par un écouteur unique délégué dans `app/app.js`. |
| Dégradation plutôt que panne | Sans Chart.js, les graphiques affichent un message et l'app fonctionne. Ce comportement a été ajouté après qu'un CDN injoignable a tué l'application entière. |

---

## 4. Structure du dépôt

```
app/                    répertoire publié
  index.html            markup (442 l.)
  styles.css            styles (1707 l.)
  app.js                logique applicative
  config.js             GÉNÉRÉ au build, non versionné
  vendor/               GÉNÉRÉ au build, non versionné
  robots.txt
supabase/
  migrations/           0001 schéma · 0002 RLS · 0003 API
  tests/                harnais + 53 tests de sécurité
scripts/
  build.mjs             génère config.js et les bundles
  import-leads.mjs      import des leads (clé de service)
  lib/leads.mjs         transformations pures, testables
  test-app.mjs          14 tests navigateur
  test-import.test.mjs  11 tests unitaires
  test-db.sh            lance les 53 tests SQL
docs/
  DEPLOIEMENT.md        mise en ligne pas à pas
  SECURITE.md           modèle de sécurité, dettes
artifact.html           ancienne variante autonome, hors périmètre
```

`data.json` **n'est pas dans le dépôt** (volontairement) et figure dans
`.gitignore`. Le propriétaire en détient une copie locale.

---

## 5. Base de données

### Tables

- **`leads`** — données de référence, 14 028 lignes. Lecture seule pour
  l'application : aucune policy d'écriture. Tout réimport passe par le
  script, qui utilise la clé de service et contourne RLS.
  Colonne générée `search_text` pour la recherche, index trigramme.
- **`lead_notes`** — notes saisies dans l'app, une ligne par note.
  Distinctes du champ `leads.notes`, qui contient l'historique figé
  importé d'Arrow.
- **`lead_issues`** — état courant du lead (statut téléphone + statut
  rendez-vous). Une ligne par lead, écrasée.
- **`agenda`** — rendez-vous. Les champs société, téléphone, ville sont
  recopiés volontairement pour survivre à un réimport.
- **`app_users`** — profils applicatifs, créés automatiquement par un
  trigger sur `auth.users`. Porte le rôle et l'activation.

### Modèle d'accès

Décidé par le propriétaire : **lecture partagée dans l'agence, écriture
bornée à son propre travail.**

| Rôle | Leads | Notes | Agenda |
|---|---|---|---|
| `commercial` | lit tout | lit tout, écrit et supprime les siennes | lit tout, gère les siens |
| `directeur` | lit tout | lit tout, corrige et supprime toutes | lit tout, gère tous |

Les statuts (`lead_issues`) sont partagés : tout commercial actif peut
les poser, c'est l'état courant du lead pour l'agence.

`active = false` coupe tout accès immédiatement et conserve
l'historique. **Ne jamais supprimer un compte** : les notes partiraient
en cascade.

### Points sensibles

- `is_active_user()` et `is_directeur()` sont en `SECURITY DEFINER` avec
  `search_path` figé. **C'est obligatoire** : elles lisent `app_users`,
  qui est elle-même sous RLS. Sans cela, une policy sur `app_users`
  s'appelant elle-même provoque une récursion infinie.
- Le trigger `app_users_guard` empêche un commercial de modifier son
  rôle, son activation ou son rattachement. Une policy `UPDATE` seule ne
  sait pas protéger une colonne précise.
- Ce trigger laisse passer les écritures quand `auth.uid()` est null,
  c'est-à-dire l'administration directe (SQL Editor, clé de service).
  **Sans cette exception, il est impossible de promouvoir le premier
  directeur.** Ce cas a été découvert par les tests, ne pas le
  réintroduire.
- `search_leads` construit son `ORDER BY` dynamiquement. La colonne est
  validée contre une liste blanche avant toute interpolation : une valeur
  inconnue retombe sur le tri par défaut. Un test vérifie qu'une chaîne
  malveillante n'atteint pas le plan de requête.
- Les vues d'agrégat sont en `security_invoker = true` : elles passent
  par les droits de l'appelant, pas du propriétaire. Un compte désactivé
  n'obtient aucune statistique.

---

## 6. Tests

```bash
npm run test:db      # 53 tests des règles d'accès (Postgres 16 local requis)
npm run test:import  # 11 tests de transformation des leads
npm run test:app     # 14 tests navigateur (Chromium requis)
```

**78 tests au total, tous au vert.**

`test:db` recrée une base vide à chaque exécution et rejoue les
migrations : un test dépendant de l'état laissé par le précédent ne
prouve rien. Le harnais `supabase/tests/00_harness.sql` reproduit
localement ce que Supabase fournit (`auth.users`, `auth.uid()`, rôles
`anon` / `authenticated`), ce qui permet de rejouer les migrations
**sans les adapter**.

`test:app` sert la page avec les en-têtes lus dans `vercel.json`, pas
avec des en-têtes de test : si la CSP de production diverge, la suite
échoue.

### Limite connue du harnais

Le harnais crée `auth.users` en tant que propriétaire, alors que sur
Supabase cette table appartient à un rôle système. Les tests valident
donc la logique, pas les droits réels. Un comportement lié aux
permissions peut passer en test et échouer en production.

---

## 7. Bugs trouvés, et à ne pas réintroduire

Tous découverts par les tests ou par un déploiement réel, pas par
relecture.

1. **Chart.js chargé depuis un CDN, `Chart.defaults` au premier niveau du
   script.** CDN injoignable et c'était l'application entière qui
   mourait, écran de connexion compris. Chart.js est désormais embarqué,
   et son initialisation protégée.
2. **Trigger `app_users_guard` bloquant l'administration directe.** La
   promotion du premier directeur en SQL échouait.
3. **Deux attributs `id` sur le formulaire de connexion.** Le premier
   l'emporte en HTML, l'écouteur de soumission ne se déclenchait jamais.
4. **Validation native du navigateur** court-circuitant les messages de
   l'application. Le formulaire porte `novalidate`, la validation est
   faite en JS pour garder des messages en français cohérents.
5. **Faille dans `@supabase/auth-js`** (`GHSA-8r88-6cj9-9fh5`), le module
   qui gère la connexion. Corrigée par montée en 2.116.0.
6. **`SUPABASE_URL` acceptant l'adresse du dashboard** au lieu de l'URL
   d'API. Le build passait, l'app se chargeait, et chaque appel échouait
   ensuite par un `Failed to fetch` inexplicable. Le build refuse
   désormais toute URL qui ne correspond pas à
   `https://<reference>.supabase.co`.

---

## 8. Où en est la mise en ligne

### Fait

- Migrations appliquées sur le projet Supabase de production.
- RLS vérifiée active sur les cinq tables.
- **14 028 leads importés**, confirmé par le script.
- Application déployée sur Vercel.
- Inscriptions libres désactivées côté Supabase.
- Compte du propriétaire créé et promu `directeur`.
- URL d'API corrigée, la communication avec Supabase fonctionne.

### Résolu : l'authentification n'envoie plus d'email

Le projet a d'abord été construit avec une authentification par lien
magique. Erreur de conception : le serveur d'envoi par défaut de Supabase
est un service de démonstration plafonné à quelques messages par heure,
et **chaque connexion consommait un email**. Dix commerciaux se
connectant le lundi matin saturaient le quota en quelques minutes.

Le parcours est désormais **email + mot de passe**
(`signInWithPassword`). L'application n'envoie plus aucun email, il n'y a
plus de dépendance à un service tiers et plus de quota.

Conséquences :

- les comptes sont créés par la direction (Authentication → Users → Add
  user → Create new user, avec *Auto Confirm User*) ;
- la réinitialisation d'un mot de passe passe par l'API admin, procédure
  dans `docs/DEPLOIEMENT.md` ;
- le message d'erreur ne distingue pas l'adresse inconnue du mot de passe
  faux, pour ne pas permettre d'énumérer les comptes existants.

Un SMTP reste souhaitable à terme (notifications, réinitialisation en
autonomie), mais il n'est plus sur le chemin critique.

### Reste à faire ensuite

- Vérifier que `https://<domaine>/data.json` renvoie bien `404`.
- Inviter les commerciaux (Authentication → Users → Add user → Send
  invitation). Ne pas leur appliquer la requête de promotion directeur.
- **Passer aux offres payantes avant d'ouvrir l'accès à l'équipe.**
  Supabase gratuit met le projet en veille après 7 jours sans activité
  (le CRM tomberait pendant les périodes creuses) et ne fournit aucune
  sauvegarde. Vercel Hobby interdit par ailleurs l'usage commercial, ce
  qui est exactement le cas ici.

---

## 9. Dettes connues

**`unsafe-inline` sur `style-src`.** Les scripts inline et les `onclick`
ont été supprimés, la CSP applique `script-src 'self'`. Il subsiste une
trentaine d'attributs `style=`, générés dynamiquement dans `app.js` ou
présents dans le markup, qui imposent `style-src 'unsafe-inline'`. Risque
d'un autre ordre : du CSS injecté peut exfiltrer par sélecteurs
d'attributs, il n'exécute pas de code. À reprendre en remplaçant ces
attributs par des classes.

**Poids du bundle.** `app/vendor/supabase.js` pèse 222 Ko minifié depuis
la montée de version, `chart.js` 202 Ko. Compressés par l'hébergeur
l'impact reste acceptable, mais c'est le premier poste du budget de
chargement. Un import sélectif de Chart.js (au lieu de `chart.js/auto`)
diviserait sa taille.

**Pas de limitation de débit applicative.** Seuls les quotas Supabase
s'appliquent.

**Pas de stratégie de sauvegarde** tant que le projet reste sur le plan
gratuit. Les leads se réimportent depuis `data.json` ; les notes, les
statuts et l'agenda, non. Ce sont les seules données irremplaçables.

**Clé exposée.** Une clé Supabase a été committée en clair dans
l'historique, puis l'historique a été purgé et vérifié depuis un clone
neuf. Une clé secrète a également transité par une capture d'écran en
cours de session. Vérifier auprès du propriétaire que les deux ont bien
été régénérées.

---

## 10. Pièges de l'environnement

- **Modifier une variable d'environnement sur Vercel ne redéploie pas.**
  `config.js` est généré au build : il faut refaire un déploiement, sinon
  l'ancienne valeur reste servie.
- **L'adresse du dashboard Supabase et l'URL d'API se ressemblent.** Le
  build refuse maintenant la première, mais c'est le piège numéro un.
- **Le SQL Editor de Supabase exécute sans session utilisateur.**
  `auth.uid()` y est null : les policies basées sur l'identité ne
  s'appliquent pas comme pour un vrai utilisateur. Tester les règles
  d'accès uniquement via `npm run test:db`, jamais depuis le SQL Editor.
- **Le compteur d'utilisateurs de Supabase est une estimation.** Il a
  affiché « 10 users » alors qu'un seul compte existait. Vérifier en SQL
  sur `auth.users`.
- **Le plan gratuit met le projet en veille.** Si l'application ne
  répond plus, vérifier d'abord si le projet Supabase est en pause.

---

## 11. Règles de travail sur ce dépôt

1. Toute nouvelle table est créée avec `enable row level security` et ses
   policies **dans la même migration**. Les droits du rôle `anon` sont
   révoqués explicitement.
2. Toute écriture engageant l'identité contraint `auth.uid()` dans son
   `with check`. Jamais une valeur fournie par le navigateur.
3. Les migrations sont immuables une fois appliquées en production :
   ajouter un nouveau fichier numéroté plutôt que modifier un existant.
4. `npm test` avant tout commit. La suite `test:db` demande un Postgres
   local, elle n'est pas optionnelle pour toute modification touchant aux
   policies.
5. Aucun secret dans le dépôt. La clé publique vit dans `config.js`,
   généré à partir des variables d'environnement et non versionné.
6. Ne pas ajouter de dépendance sans vérifier sa taille et son état de
   maintenance. L'app est chargée en 4G depuis une voiture.
