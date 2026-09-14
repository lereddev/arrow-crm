#!/usr/bin/env node
/**
 * Prépare app/ pour la mise en ligne :
 *   1. génère app/config.js depuis les variables d'environnement ;
 *   2. regroupe le SDK Supabase en un seul fichier servi par nos soins.
 *
 * Le SDK est embarqué plutôt que chargé depuis un CDN : une
 * dépendance tierce récupérée à l'exécution sur une application qui
 * manipule des données nominatives est une surface d'attaque inutile.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const appDir = join(root, 'app');

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  console.error('SUPABASE_URL et SUPABASE_ANON_KEY doivent être définis.');
  console.error('En local : cp .env.example .env puis renseignez-le.');
  console.error('Sur Vercel ou Netlify : variables d\'environnement du projet.');
  process.exit(1);
}

if (/service_role/i.test(anonKey) || anonKey.startsWith('sb_secret')) {
  console.error('Refus : la valeur fournie ressemble à une clé de service.');
  console.error('Seule la clé « anon » doit être publiée dans le navigateur.');
  process.exit(1);
}

await mkdir(join(appDir, 'vendor'), { recursive: true });

await writeFile(
  join(appDir, 'config.js'),
  `// Généré par scripts/build.mjs — ne pas modifier à la main.\n`
  + `window.ARROW_CONFIG = ${JSON.stringify({ supabaseUrl: url, supabaseAnonKey: anonKey }, null, 2)};\n`,
  'utf8'
);
console.log('app/config.js généré.');

const bundles = [
  { name: 'supabase.js',
    entry: "import { createClient } from '@supabase/supabase-js';\n"
         + 'window.supabase = { createClient };\n' },
  { name: 'chart.js',
    entry: "import Chart from 'chart.js/auto';\nwindow.Chart = Chart;\n" }
];

for (const b of bundles) {
  await build({
    stdin: { contents: b.entry, resolveDir: root, loader: 'js' },
    bundle: true,
    format: 'iife',
    minify: true,
    target: 'es2020',
    outfile: join(appDir, 'vendor', b.name)
  });
  console.log(`app/vendor/${b.name} généré.`);
}
