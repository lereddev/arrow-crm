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

const BATCH = 500;

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const source = process.argv[2] ?? 'data.json';

if (!url || !key) {
  console.error('SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont requis.');
  console.error('Voir .env.example et docs/DEPLOIEMENT.md.');
  process.exit(1);
}

/** « 10/01/2025 » -> « 2025-01-10 ». Renvoie null si la forme ne colle pas. */
function toIsoDate(value) {
  if (typeof value !== 'string') return null;
  const m = value.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const [, d, mo, y] = m;
  const date = new Date(Date.UTC(+y, +mo - 1, +d));
  // Rejette les dates qui ne survivent pas à l'aller-retour (31/02 par exemple).
  if (date.getUTCDate() !== +d || date.getUTCMonth() !== +mo - 1) return null;
  return `${y}-${mo}-${d}`;
}

function toSmallint(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= -32768 && n <= 32767 ? n : null;
}

function toInt(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function clean(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s === '' ? null : s;
}

function toRow(lead) {
  return {
    id:               lead.id,
    siren:            clean(lead.siren) ?? `sans-siren-${lead.id}`,
    societe:          clean(lead.societe),
    profession:       clean(lead.profession),
    departement:      toSmallint(lead.departement),
    ville:            clean(lead.ville),
    adresse:          clean(lead.adresse),
    telephone:        clean(lead.telephone),
    priorite:         clean(lead.priorite) ?? 'Inconnu',
    statut:           clean(lead.statut),
    date_rdv:         clean(lead.date_rdv),
    date_rdv_date:    toIsoDate(lead.date_rdv),
    nb_rdvs:          toInt(lead.nb_rdvs),
    nb_audits:        toInt(lead.nb_audits),
    premiere_periode: clean(lead.premiere_periode),
    derniere_periode: clean(lead.derniere_periode),
    commercial:       clean(lead.commercial),
    notes:            clean(lead.notes),
    lien_arrow:       clean(lead.lien_arrow)
  };
}

const raw = JSON.parse(await readFile(source, 'utf8'));
if (!Array.isArray(raw)) {
  console.error(`${source} ne contient pas un tableau de leads.`);
  process.exit(1);
}

const rows = raw.map(toRow);

// Un SIREN dupliqué ferait échouer tout le lot sur la contrainte
// d'unicité, avec un message illisible. On le détecte ici.
const seen = new Map();
const duplicates = [];
for (const row of rows) {
  if (seen.has(row.siren)) duplicates.push([seen.get(row.siren), row.id, row.siren]);
  else seen.set(row.siren, row.id);
}
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
