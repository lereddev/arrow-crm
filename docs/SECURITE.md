# Sécurité

## Modèle

L'application est un client statique qui parle directement à Postgres
via PostgREST. Il n'y a pas de serveur applicatif intermédiaire : **la
sécurité repose entièrement sur Row Level Security.** Une policy
manquante n'est pas une gêne, c'est une fuite.

D'où trois règles :

1. Toute nouvelle table est créée avec `enable row level security` et
   ses policies dans la même migration.
2. Les droits du rôle `anon` sont révoqués explicitement.
3. Toute écriture qui engage l'identité de l'utilisateur contraint
   `auth.uid()` dans son `with check`, jamais une valeur fournie par le
   navigateur.

## Les clés

| Clé | Où elle vit | Ce qu'elle donne |
|---|---|---|
| `anon` | dans le navigateur, via `app/config.js` | rien par elle-même, RLS décide |
| `service_role` | machine d'administration et rien d'autre | accès total, contourne RLS |

La clé `anon` est **conçue** pour être publique. La voir dans le code
source de la page n'est pas un incident. La clé de service, si.

`scripts/build.mjs` refuse de construire si la valeur passée en clé
publique ressemble à une clé de service.

## À faire avant la première mise en ligne

### Faire tourner la clé exposée

Le dépôt a contenu une clé Supabase en clair, committée dans
l'historique. Elle doit être considérée comme compromise, même si le
dépôt est privé.

Dashboard Supabase → Settings → API → régénérer les clés, puis mettre à
jour les variables d'environnement chez l'hébergeur et relancer un
déploiement.

### Purger l'historique Git

`data.json` et l'ancienne `index.html` monofichier ont été versionnés.
Les retirer de l'arborescence ne les retire pas de l'historique : un
`git log -p` les restitue intégralement.

Deux options :

**Repartir d'un dépôt neuf** — le plus simple et le plus sûr. Créer un
nouveau dépôt privé, y pousser l'état courant sans reprendre
l'historique, archiver l'ancien.

**Réécrire l'historique** avec [git-filter-repo](https://github.com/newren/git-filter-repo) :

```bash
git filter-repo --invert-paths --path data.json --path index.html
git push --force --all
```

Réécrire l'historique invalide les clones existants. Prévenir quiconque
en possède un.

## Données personnelles

Le fichier contient des données nominatives : raisons sociales,
personnes physiques (entrepreneurs individuels), téléphones, adresses,
SIREN, et des notes commerciales qui portent des appréciations sur des
personnes identifiables. C'est un traitement de données personnelles.

Ce que la mise en place apporte :

- accès nominatif, révocable, tracé côté Supabase
- pas de fichier téléchargeable en bloc
- `X-Robots-Tag: noindex` et `robots.txt` bloquant

Ce qui reste à ta charge, et qui ne relève pas du code :

- inscrire le traitement au registre de l'entreprise
- définir et appliquer une durée de conservation (un lead froid de 2021
  n'a pas vocation à rester indéfiniment)
- prévoir le traitement des demandes d'accès, de rectification et
  d'opposition
- vérifier que la mention d'information à la prospection est bien
  délivrée

## Tests

Trois suites, exécutables séparément :

```bash
npm run test:db      # 53 tests des règles d'accès, sur un Postgres local
npm run test:import  # 11 tests de la transformation des leads
npm run test:app     # 11 tests navigateur, page servie avec sa CSP réelle
npm test             # logique métier et parcours navigateur (test:db exige Postgres)
```

`test:db` repart d'une base vide à chaque exécution et rejoue les
migrations : un test qui dépend de l'état laissé par le précédent ne
prouve rien. Il vérifie notamment qu'un commercial ne peut ni se
nommer directeur, ni se réactiver un accès coupé, ni signer une note
au nom d'un collègue, ni modifier un lead, et qu'une chaîne
malveillante passée en colonne de tri n'atteint jamais le plan de
requête.

`test:app` sert la page avec les en-têtes lus dans `vercel.json`, pas
avec des en-têtes de test : le jour où la CSP de production diverge,
la suite échoue. Il exige un Chromium (`npx playwright install
chromium`, ou `CHROME_PATH` vers un binaire existant).

### Historique des rendez-vous

`rdv_history` et `rdv_signals` sont des données de référence en lecture seule.
Elles ont RLS activé et forcé, aucune policy d'écriture et aucun droit pour `anon`.
La table temporaire `rdv_import_staging` n'a aucun grant applicatif ni policy: seul
un administrateur de base peut y charger l'import privé et lancer sa finalisation.

## Dette connue

**`unsafe-inline` sur `style-src`.** Les scripts inline et les
attributs `onclick` ont été supprimés : la page passe les événements
par un écouteur unique et délégué, et la CSP applique désormais
`script-src 'self'`. Du code injecté dans la page ne s'exécute plus.

Il subsiste une trentaine d'attributs `style=`, ce qui impose
`style-src 'unsafe-inline'`. Le risque résiduel est d'un tout autre
ordre : du CSS injecté peut servir à exfiltrer par sélecteurs
d'attributs, il n'exécute pas de code. À reprendre en remplaçant ces
attributs par des classes.

**Pas de limitation de débit applicative.** Supabase applique ses
propres quotas sur l'envoi d'emails d'authentification. Aucune
limitation supplémentaire n'est posée côté application.

## En cas de compte compromis

```sql
update public.app_users set active = false where email = '...';
```

Puis, dans le dashboard Supabase, Authentication → Users → révoquer les
sessions de l'utilisateur. Sans cette seconde étape, un jeton déjà émis
reste valide jusqu'à son expiration.
