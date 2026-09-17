#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { prepareRdvRows, toCsv } from './lib/rdv-import.mjs';

const source = process.argv[2];
const target = process.argv[3] || '/tmp/arrow-rdv-import.csv';
if (!source) {
  console.error('Usage: node scripts/prepare-rdv-import.mjs <events.json> [sortie.csv]');
  process.exit(1);
}

const events = JSON.parse(await readFile(source, 'utf8'));
if (!Array.isArray(events)) throw new Error('Le fichier source doit contenir un tableau.');
const rows = prepareRdvRows(events);
await writeFile(target, toCsv(rows), { encoding: 'utf8', mode: 0o600 });

const signals = rows.reduce((total, row) => total + row.signals.length, 0);
console.log(`${rows.length} rendez-vous uniques préparés, ${signals} catégories, sortie : ${target}`);
