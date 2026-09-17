import { createHash } from 'node:crypto';
import { classifyRdvNote } from './rdv-signals.mjs';

const MONTHS = new Map([
  ['janvier', 1], ['fevrier', 2], ['mars', 3], ['avril', 4], ['mai', 5], ['juin', 6],
  ['juillet', 7], ['aout', 8], ['septembre', 9], ['octobre', 10], ['novembre', 11], ['decembre', 12]
]);
const clean = value => String(value || '').trim();
const normalize = value => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export function eventYear(source) {
  if (source === 'RDV_Arrow_01-2025_03-2026.xlsx') return 2025;
  return Number(source.match(/20\d{2}/)?.[0]) || null;
}

export function parseRdvDate(value, source) {
  const match = normalize(value).match(/(?:lun|mar|mer|jeu|ven|sam|dim)\.?\s+(\d{1,2})\s+([a-z]+)/);
  const year = eventYear(source);
  const month = match ? MONTHS.get(match[2]) : null;
  if (!match || !year || !month) return null;
  const day = Number(match[1]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function fingerprint(event) {
  return ['siren', 'date_rdv', 'issue_rdv', 'note_issue_rdv', 'confirmation_rdv']
    .map(key => clean(event[key])).join('\u001f');
}

function uuidFrom(value) {
  const hex = createHash('sha256').update(value).digest('hex').slice(0, 32).split('');
  hex[12] = '4';
  hex[16] = ((parseInt(hex[16], 16) & 3) | 8).toString(16);
  const joined = hex.join('');
  return `${joined.slice(0, 8)}-${joined.slice(8, 12)}-${joined.slice(12, 16)}-${joined.slice(16, 20)}-${joined.slice(20)}`;
}

export function prepareRdvRows(events) {
  const seen = new Set();
  const rows = [];
  for (const event of events) {
    const isLatest = event.source === 'RDV_Arrow_01-2025_03-2026.xlsx';
    if (!isLatest && !clean(event.issue_rdv) && !clean(event.note_issue_rdv)) continue;
    const key = fingerprint(event);
    if (seen.has(key)) continue;
    seen.add(key);
    const siren = clean(event.siren);
    if (!/^\d{9}$/.test(siren)) throw new Error(`SIREN invalide dans ${event.source}, ligne ${event.row}`);
    const sourceKey = createHash('sha256').update(key).digest('hex');
    rows.push({
      id: uuidFrom(sourceKey), source_key: sourceKey, siren,
      occurred_on: parseRdvDate(event.date_rdv, event.source), date_rdv_text: clean(event.date_rdv),
      commercial: clean(event.commercial), confirmation_rdv: clean(event.confirmation_rdv),
      issue_rdv: clean(event.issue_rdv), note_issue_rdv: clean(event.note_issue_rdv),
      source_period: event.source.replace(/\.xlsx$/i, ''),
      signals: classifyRdvNote(event.note_issue_rdv)
    });
  }
  return rows;
}

const csvCell = value => {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return `"${String(text ?? '').replaceAll('"', '""')}"`;
};

export function toCsv(rows) {
  const headers = ['id', 'source_key', 'siren', 'occurred_on', 'date_rdv_text', 'commercial',
    'confirmation_rdv', 'issue_rdv', 'note_issue_rdv', 'source_period', 'signals'];
  return [headers.join(','), ...rows.map(row => headers.map(header => csvCell(row[header] ?? '')).join(','))].join('\n') + '\n';
}
