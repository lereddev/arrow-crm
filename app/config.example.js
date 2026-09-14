// Copie de référence. Le fichier réellement servi, app/config.js, est
// produit par `npm run build` à partir des variables d'environnement
// et n'est pas versionné.
//
// La clé « anon » est publique par conception : elle identifie le
// projet, elle n'autorise rien. Ce sont les policies RLS qui décident
// de ce qu'un utilisateur connecté peut lire et écrire. La clé de
// service, elle, ne doit jamais apparaître ici.
window.ARROW_CONFIG = {
  supabaseUrl: 'https://VOTRE-PROJET.supabase.co',
  supabaseAnonKey: 'VOTRE_CLE_ANON'
};
