/**
 * Transformation des leads bruts d'Arrow vers le schéma de la base.
 *
 * Isolé du script d'import pour être testable sans base ni réseau :
 * c'est ici qu'une erreur passerait inaperçue et corromprait 14 000
 * lignes d'un coup.
 */
/** « 10/01/2025 » -> « 2025-01-10 ». Renvoie null si la forme ne colle pas. */
export function toIsoDate(value) {
  if (typeof value !== 'string') return null;
  const m = value.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const [, d, mo, y] = m;
  const date = new Date(Date.UTC(+y, +mo - 1, +d));
  // Rejette les dates qui ne survivent pas à l'aller-retour (31/02 par exemple).
  if (date.getUTCDate() !== +d || date.getUTCMonth() !== +mo - 1) return null;
  return `${y}-${mo}-${d}`;
}

export function toSmallint(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= -32768 && n <= 32767 ? n : null;
}

export function toInt(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

export function clean(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s === '' ? null : s;
}

export function toRow(lead) {
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

/** Renvoie les collisions de SIREN : elles feraient échouer tout le
 *  lot sur la contrainte d'unicité, avec un message illisible. */
export function findDuplicateSirens(rows) {
  const seen = new Map();
  const duplicates = [];
  for (const row of rows) {
    if (seen.has(row.siren)) duplicates.push([seen.get(row.siren), row.id, row.siren]);
    else seen.set(row.siren, row.id);
  }
  return duplicates;
}
