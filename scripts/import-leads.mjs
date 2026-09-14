#!/usr/bin/env node
/**
 * Importe data.json dans la table `leads`.
 *
 * Utilise la clé de service, qui contourne RLS : c'est le seul
 * chemin d'écriture vers `leads`. Cette clé ne doit jamais quitter ta
 * machine ni le gestionnaire de secrets de ton hébergeur — elle donne
 * un accès total à la base.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     node scripts/import-leads.mjs ../data.json
 *
 * Idempotent : relancer réimporte par-dessus (upsert sur `id`).
 */
import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { toRow, findDuplicateSirens } from './lib/leads.mjs';

const BATCH = 500;

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const source = process.argv[2] ?? 'data.json';

if (!url || !key) {
  console.error('SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont requis.');
  console.error('Voir .env.example et docs/DEPLOIEMENT.md.');
  process.exit(1);
}

const raw = JSON.parse(await readFile(source, 'utf8'));
if (!Array.isArray(raw)) {
  console.error(`${source} ne contient pas un tableau de leads.`);
  process.exit(1);
}

const rows = raw.map(toRow);

const duplicates = findDuplicateSirens(rows);
if (duplicates.length) {
  console.error(`${duplicates.length} SIREN en double, import interrompu :`);
  for (const [a, b, siren] of duplicates.slice(0, 10)) {
    console.error(`  ${siren} — leads ${a} et ${b}`);
  }
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

console.log(`Import de ${rows.length} leads depuis ${source}…`);
let done = 0;

for (let i = 0; i < rows.length; i += BATCH) {
  const slice = rows.slice(i, i + BATCH);
  const { error } = await supabase
    .from('leads')
    .upsert(slice, { onConflict: 'id', defaultToNull: false });

  if (error) {
    console.error(`\nÉchec sur le lot ${i}–${i + slice.length} : ${error.message}`);
    console.error(`${done} leads avaient déjà été importés. Relancer reprendra par-dessus.`);
    process.exit(1);
  }

  done += slice.length;
  process.stdout.write(`\r  ${done}/${rows.length}`);
}

const { count, error: countError } = await supabase
  .from('leads')
  .select('id', { count: 'exact', head: true });

console.log('\nImport terminé.');
if (countError) console.warn(`Vérification du total impossible : ${countError.message}`);
else console.log(`La table contient ${count} leads.`);
