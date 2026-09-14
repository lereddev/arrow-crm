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

## Dette connue

**`unsafe-inline` dans la CSP.** L'interface utilise des attributs
`onclick` en ligne et une feuille de style embarquée, ce qui impose
`script-src 'unsafe-inline'`. La protection contre le XSS en est
nettement affaiblie : une chaîne non échappée injectée dans le DOM
deviendrait exécutable.

Le risque est aujourd'hui limité — les seules données affichées
proviennent de la base, et `sanitize()` est appliqué aux champs texte —
mais il ne disparaîtra qu'en remplaçant les `onclick` par des
écouteurs délégués et en sortant le CSS dans un fichier. C'est la
première dette à résorber.

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
