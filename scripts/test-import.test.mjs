/**
 * Tests de la transformation des leads.
 *
 *   npm run test:import
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toIsoDate, toSmallint, toInt, clean, toRow, findDuplicateSirens } from './lib/leads.mjs';

test('une date française est convertie au format ISO', () => {
  assert.equal(toIsoDate('10/01/2025'), '2025-01-10');
  assert.equal(toIsoDate('31/12/2024'), '2024-12-31');
});

test('une date absente ou mal formée ne bloque pas l\'import', () => {
  for (const value of [null, undefined, '', '2025-01-10', '1/1/2025', 'bientôt', 42]) {
    assert.equal(toIsoDate(value), null, `échec sur ${JSON.stringify(value)}`);
  }
});

test('une date qui n\'existe pas est rejetée plutôt que décalée', () => {
  // Sans contrôle, JavaScript transforme le 31 février en 3 mars.
  assert.equal(toIsoDate('31/02/2025'), null);
  assert.equal(toIsoDate('32/01/2025'), null);
  assert.equal(toIsoDate('10/13/2025'), null);
});

test('un département hors bornes ne casse pas la colonne', () => {
  assert.equal(toSmallint(83), 83);
  assert.equal(toSmallint('974'), 974);
  assert.equal(toSmallint(null), null);
  assert.equal(toSmallint(''), null);
  assert.equal(toSmallint('2A'), null);      // Corse en notation lettrée
  assert.equal(toSmallint(99999), null);     // dépasse smallint
});

test('les compteurs sont toujours des entiers', () => {
  assert.equal(toInt('86'), 86);
  assert.equal(toInt(null), 0);
  assert.equal(toInt('abc'), 0);
  assert.equal(toInt(3.7), 3);
});

test('les chaînes vides deviennent des valeurs nulles', () => {
  assert.equal(clean('  Garage  '), 'Garage');
  assert.equal(clean('   '), null);
  assert.equal(clean(null), null);
});

test('un lead sans SIREN reçoit une clé de repli unique', () => {
  // La colonne siren est UNIQUE et NOT NULL : deux leads sans SIREN
  // ne doivent pas entrer en collision.
  const a = toRow({ id: 1, siren: null, priorite: '🔥 Chaud' });
  const b = toRow({ id: 2, siren: '', priorite: '🔥 Chaud' });
  assert.equal(a.siren, 'sans-siren-1');
  assert.equal(b.siren, 'sans-siren-2');
  assert.notEqual(a.siren, b.siren);
});

test('un lead sans priorité est rangé plutôt que perdu', () => {
  assert.equal(toRow({ id: 1, siren: '1' }).priorite, 'Inconnu');
});

test('un lead complet est transposé champ à champ', () => {
  const row = toRow({
    id: 7, siren: '434533667', societe: 'MS Carrosserie', profession: 'Garage',
    departement: 83, ville: 'SAINT-RAPHAEL', adresse: '35 impasse Bellay',
    telephone: '04 94 95 01 94', priorite: '🔥 Chaud', statut: 'Confirmé',
    date_rdv: '10/01/2025', nb_rdvs: 86, nb_audits: 1,
    premiere_periode: 'S1 2023', derniere_periode: '2025-2026',
    commercial: 'G.Gay', notes: 'Eu le client', lien_arrow: null
  });
  assert.equal(row.societe, 'MS Carrosserie');
  assert.equal(row.departement, 83);
  assert.equal(row.date_rdv, '10/01/2025');
  assert.equal(row.date_rdv_date, '2025-01-10');
  assert.equal(row.nb_rdvs, 86);
  assert.equal(row.lien_arrow, null);
});

test('les SIREN en double sont détectés avant toute écriture', () => {
  const rows = [
    { id: 1, siren: '100' }, { id: 2, siren: '200' }, { id: 3, siren: '100' }
  ];
  const duplicates = findDuplicateSirens(rows);
  assert.equal(duplicates.length, 1);
  assert.deepEqual(duplicates[0], [1, 3, '100']);
});

test('un jeu sans doublon ne remonte rien', () => {
  assert.equal(findDuplicateSirens([{ id: 1, siren: 'a' }, { id: 2, siren: 'b' }]).length, 0);
});
