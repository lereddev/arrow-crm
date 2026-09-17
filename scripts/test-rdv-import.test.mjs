import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRdvDate, prepareRdvRows, toCsv } from './lib/rdv-import.mjs';

test('French appointment dates use the year of their workbook', () => {
  assert.equal(parseRdvDate('Mar. 3 septembre', '2019/RDV_Q4_2019.xlsx'), '2019-09-03');
  assert.equal(parseRdvDate('Ven. 10 janvier', 'RDV_Arrow_01-2025_03-2026.xlsx'), '2025-01-10');
  assert.equal(parseRdvDate('date inconnue', '2024/file.xlsx'), null);
});

test('repeated latest workbook blocks become 100 unique rows', () => {
  const block = Array.from({ length: 100 }, (_, index) => ({
    source: 'RDV_Arrow_01-2025_03-2026.xlsx', row: index + 2, siren: String(100000000 + index),
    date_rdv: 'Mar. 7 janvier', issue_rdv: '', note_issue_rdv: '', confirmation_rdv: 'Confirmé'
  }));
  const rows = prepareRdvRows([...block, ...block, ...block]);
  assert.equal(rows.length, 100);
  assert.equal(new Set(rows.map(row => row.id)).size, 100);
});

test('older rows without an issue or note are excluded', () => {
  const rows = prepareRdvRows([{ source: '2024/file.xlsx', row: 2, siren: '123456789', date_rdv: 'Mar. 2 janvier' }]);
  assert.deepEqual(rows, []);
});

test('CSV escapes customer text and serializes signals', () => {
  const csv = toCsv([{ id: 'id', source_key: 'key', siren: '123456789', note_issue_rdv: 'Dit "oui", puis non', signals: [{ kind: 'need', label: 'SEO', confidence: 'confirmed' }] }]);
  assert.match(csv, /"Dit ""oui"", puis non"/);
  assert.match(csv, /"\[{""kind"":""need""/);
});
