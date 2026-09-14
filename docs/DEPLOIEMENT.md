# Mise en ligne

Trois étapes : la base, l'application, les comptes.

## 1. La base

### Appliquer les migrations

Dans le SQL Editor du dashboard Supabase, exécuter dans l'ordre :

1. `supabase/migrations/0001_schema.sql`
2. `supabase/migrations/0002_rls.sql`
3. `supabase/migrations/0003_api.sql`

Ou, avec la CLI Supabase :

```bash
supabase link --project-ref VOTRE_REF
supabase db push
```

### Vérifier que RLS est bien actif

```sql
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in ('leads','lead_notes','lead_issues','agenda','app_users');
```

Les cinq lignes doivent afficher `rowsecurity = true`. Si l'une est à
`false`, ne pas mettre en ligne : la table est lisible par tout compte.

### Importer les leads

```bash
cp .env.example .env        # renseigner les trois valeurs
npm install
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run import-leads
```

Le script s'arrête avant d'écrire quoi que ce soit si deux leads
partagent un SIREN.

### Fermer l'inscription libre

**Indispensable.** Dashboard Supabase → Authentication → Providers →
Email → désactiver *Enable sign-ups*.

Sans cela, n'importe qui saisissant une adresse sur l'écran de
connexion se crée un compte et accède aux 14 028 fiches. Le front
demande déjà `shouldCreateUser: false`, mais cette option vit dans du
code envoyé au navigateur : elle se contourne. Le réglage serveur, non.

### Déclarer l'URL de retour

Authentication → URL Configuration :

- *Site URL* : l'URL de production (par exemple `https://crm.exemple.fr`)
- *Redirect URLs* : cette même URL, plus `http://localhost:5173` pour le
  développement

Un lien magique redirigeant vers une URL non déclarée est refusé.

## 2. L'application

### Vercel

1. Importer le dépôt.
2. Variables d'environnement : `SUPABASE_URL`, `SUPABASE_ANON_KEY`.
   **Ne jamais y mettre la clé de service.**
3. Le reste est dans `vercel.json` : commande de build, répertoire
   publié, en-têtes de sécurité.

### Netlify

Identique, la configuration est dans `netlify.toml`. Supprimer le
fichier de l'hébergeur non retenu pour éviter toute ambiguïté.

### Vérifier après le premier déploiement

```bash
# Doit renvoyer 404 : le fichier de prospection n'est pas publié.
curl -so /dev/null -w '%{http_code}\n' https://VOTRE-DOMAINE/data.json

# Doit lister les en-têtes de sécurité.
curl -sI https://VOTRE-DOMAINE | grep -i 'content-security\|strict-transport\|x-frame'
```

## 3. Les comptes

### Créer le compte d'un commercial

Dashboard Supabase → Authentication → Users → **Add user** → **Create
new user**.

- son adresse professionnelle
- un mot de passe (12 caractères minimum, généré au hasard)
- cocher **Auto Confirm User**

**Aucun email n'est envoyé.** Transmets-lui ses identifiants de vive voix
ou par un canal sûr, et demande-lui de le changer à la première
connexion.

Ce choix est délibéré : le service d'envoi par défaut de Supabase est
plafonné à quelques messages par heure. Avec une authentification par
email, la deuxième personne qui se connecte le matin reste dehors.

La ligne correspondante dans `app_users` est créée automatiquement, avec
le rôle `commercial`.

### Réinitialiser un mot de passe oublié

Toujours sans email, avec la clé de service :

```bash
curl -X PUT "https://VOTRE-PROJET.supabase.co/auth/v1/admin/users/UID_DE_LA_PERSONNE" \
  -H "apikey: CLE_SECRETE" \
  -H "Authorization: Bearer CLE_SECRETE" \
  -H "Content-Type: application/json" \
  -d '{"password":"NOUVEAU_MOT_DE_PASSE"}'
```

L'UID se lit dans Authentication → Users.

### Se donner le rôle directeur

Après ta première connexion :

```sql
update public.app_users
set role = 'directeur', commercial_code = 'VOTRE_CODE'
where email = 'ton.adresse@exemple.fr';
```

Renseigner `commercial_code` avec le libellé exact utilisé dans la
colonne `commercial` des leads.

### Rattacher un commercial à son portefeuille

```sql
update public.app_users set commercial_code = 'G.Gay'
where email = 'g.gay@exemple.fr';
```

### Couper l'accès de quelqu'un

```sql
update public.app_users set active = false
where email = 'personne@exemple.fr';
```

Effet immédiat à la requête suivante : toutes les policies passent par
`is_active_user()`. L'historique est conservé. Préférer cela à la
suppression du compte, qui effacerait ses notes en cascade.

## Revenir en arrière

| Incident | Action | Durée |
|---|---|---|
| Régression applicative | Vercel/Netlify → *Redeploy* de la version précédente | < 1 min |
| Migration fautive | Restaurer le point de sauvegarde Supabase | quelques minutes |
| Import erroné | Relancer l'import depuis le `data.json` de référence | ~2 min |
| Compte compromis | `active = false`, puis révoquer ses sessions dans le dashboard | < 1 min |

Les sauvegardes automatiques dépendent du plan Supabase. Sur le plan
gratuit, il n'y en a pas : exporter régulièrement les tables de saisie
(`lead_notes`, `lead_issues`, `agenda`), qui sont les seules données
irremplaçables. Les leads, eux, se réimportent.
