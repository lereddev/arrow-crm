import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyRdvNote } from './lib/rdv-signals.mjs';

const find = (text, label) => classifyRdvNote(text).find(signal => signal.label === label);

test('explicit needs can coexist on one appointment', () => {
  const signals = classifyRdvNote('Monsieur veut une refonte de site et travailler son SEO puis Google Ads.');
  assert.deepEqual(signals.filter(signal => signal.kind === 'need').map(signal => signal.label), ['SEA', 'SEO', 'Site internet']);
  assert.ok(signals.every(signal => signal.confidence === 'confirmed'));
});

test('ambiguous local visibility stays a suggested GMB category', () => {
  assert.deepEqual(find('Besoin de davantage de visibilité locale.', 'GMB'), {
    kind: 'need', label: 'GMB', confidence: 'suggested'
  });
});

test('urgency only suggests SEA when acquisition is also mentioned', () => {
  assert.equal(find('Monsieur veut aller vite.', 'SEA'), undefined);
  assert.equal(find('Il veut rapidement obtenir de nouveaux clients.', 'SEA')?.confidence, 'suggested');
});

test('budget and business need are retained separately', () => {
  const signals = classifyRdvNote('Intéressé par une fiche Google mais budget trop faible actuellement.');
  assert.deepEqual(signals.map(({ label, confidence }) => [label, confidence]), [['Budget', 'confirmed'], ['GMB', 'confirmed']]);
});

test('empty and unrelated notes do not invent a category', () => {
  assert.deepEqual(classifyRdvNote(''), []);
  assert.deepEqual(classifyRdvNote('Rendez-vous réalisé avec Monsieur.'), []);
});
