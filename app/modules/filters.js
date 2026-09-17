export const PAGE_SIZE = 50;
export const NAMED_DEPARTMENTS = [84,13,30,34,26,20,974,69,1,38,42,6,83,4];
export const TERRITORIES = [
  { id: '', name: 'Tous', description: 'Tous les secteurs', departments: [] },
  { id: 'avignon', name: 'Avignon', description: 'Avignon et alentours · 84, 13, 30, 34, 26', departments: [84, 13, 30, 34, 26] },
  { id: 'corse', name: 'Corse', description: 'Corse · départements regroupés sous le code 20', departments: [20] },
  { id: 'reunion', name: 'Réunion', description: 'La Réunion · 974', departments: [974] },
  { id: 'lyon', name: 'Lyonnais', description: 'Région lyonnaise · 69, 01, 38, 42', departments: [69, 1, 38, 42] },
  { id: 'alpes', name: 'Alpes–Côte d’Azur', description: 'Alpes–Côte d’Azur · 06, 83, 04', departments: [6, 83, 4] },
  { id: 'other', name: 'Autres', description: 'Tous les départements hors secteurs principaux', departments: [], outside: true }
];
export const PRIORITIES = ['🔥 Chaud', '⭐ Tiède', '❄️ Froid', '🔄 Client', '🚫 Exclu'];
export const TEL_ISSUES = ['Confirmé', 'Annulé', 'Reporté', 'Injoignable', 'Répondeur', 'À repositionner', 'Hors cible', 'À rappeler', 'R2 confirmé'];
export const RDV_ISSUES = ['Signé', 'Refus', 'Réalisé', 'Reporté', 'Annulé', 'R2 positionné', 'R2 refus', 'Lapin'];
export const NEEDS = ['GMB', 'SEO', 'SEA', 'Site internet', 'E-commerce', 'Réseaux sociaux', 'Avis / réputation'];
export const BLOCKERS = ['Budget', 'Engagé ailleurs', 'Timing', 'Décideur absent'];
export const SORTS = [['societe', 'Entreprise A–Z'], ['priorite', 'Priorité'], ['ville', 'Ville'], ['date_rdv', 'Dernier RDV'], ['nb_rdvs', 'Nombre de RDV']];
export const FILTER_LABELS = { q: 'Recherche', need: 'Besoin', blocker: 'Frein', historyRdv: 'Issue RDV historique',
  tel: 'Issue téléphone actuelle', rdv: 'Issue RDV actuelle', priority: 'Priorité historique Arrow', dept: 'Département',
  profession: 'Métier', commercial: 'Commercial', status: 'Statut importé' };

export function readFilters(search = location.search) {
  const params = new URLSearchParams(search);
  const territory = TERRITORIES.find(item => item.id === params.get('sector')) || TERRITORIES[0];
  const state = { sector: territory.id, sort: SORTS.some(([key]) => key === params.get('sort')) ? params.get('sort') : 'societe', page: 1 };
  for (const key of Object.keys(FILTER_LABELS)) state[key] = (params.get(key) || '').slice(0, 160);
  state.page = Math.max(1, Math.min(100000, parseInt(params.get('page'), 10) || 1));
  if (!PRIORITIES.includes(state.priority)) state.priority = '';
  if (![...TEL_ISSUES, '__empty', ''].includes(state.tel)) state.tel = '';
  if (![...RDV_ISSUES, '__empty', ''].includes(state.rdv)) state.rdv = '';
  if (![...RDV_ISSUES, '__empty', ''].includes(state.historyRdv)) state.historyRdv = '';
  if (![...NEEDS, ''].includes(state.need)) state.need = '';
  if (![...BLOCKERS, ''].includes(state.blocker)) state.blocker = '';
  if (!/^\d{1,3}$/.test(state.dept)) state.dept = '';
  return state;
}

export function filterParams(state) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(state)) {
    if (value && !(key === 'page' && value === 1) && !(key === 'sort' && value === 'societe')) params.set(key, value);
  }
  return params;
}

export function rpcFilters(state) {
  const territory = TERRITORIES.find(item => item.id === state.sector) || TERRITORIES[0];
  return {
    p_departments: territory.departments.length ? territory.departments : null,
    p_excluded_departments: territory.outside ? NAMED_DEPARTMENTS : null,
    p_departement: state.dept ? Number(state.dept) : null,
    p_search: state.q.trim() || null, p_priorite: state.priority || null,
    p_issue_tel: state.tel || null, p_issue_rdv: state.rdv || null,
    p_historical_issue: state.historyRdv || null, p_need: state.need || null, p_blocker: state.blocker || null,
    p_profession: state.profession || null, p_commercial: state.commercial || null,
    p_statut: state.status || null, p_sort: state.sort,
    p_offset: (state.page - 1) * PAGE_SIZE, p_limit: PAGE_SIZE
  };
}
