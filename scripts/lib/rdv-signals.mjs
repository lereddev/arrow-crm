const normalize = value => String(value || '').normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[’']/g, ' ');

const RULES = [
  ['need', 'GMB', 'confirmed', /\b(gmb|google my business|google business profile|fiche google|google maps)\b/],
  ['need', 'GMB', 'suggested', /\b(referencement local|visibilite locale|apparaitre localement|localites?|zone locale|recherche locale|fiche etablissement|maps?)\b/],
  ['need', 'SEO', 'confirmed', /\b(seo|referencement naturel|ref naturel|positionnement naturel|optimisation organique)\b/],
  ['need', 'SEO', 'suggested', /\b(positionnement google|remonter sur google|visibilite( sur google)?|etre visible|premiere page|mieux reference)\b/],
  ['need', 'SEA', 'confirmed', /\b(sea|google ads|adwords|referencement payant|ref payant|campagne google|pub google|liens sponsorises)\b/],
  ['need', 'Site internet', 'confirmed', /\b(site (internet|web)|refonte (du |de )?site|creation (du |de )?site|nouveau site|vitrine web)\b/],
  ['need', 'E-commerce', 'confirmed', /\b(e[ -]?commerce|boutique en ligne|vente en ligne|site marchand)\b/],
  ['need', 'Réseaux sociaux', 'confirmed', /\b(reseaux sociaux|facebook|instagram|linkedin|community management|social media)\b/],
  ['need', 'Avis / réputation', 'confirmed', /\b(avis (google|clients?)|e[ -]?reputation|reputation en ligne|gestion des avis)\b/],
  ['blocker', 'Budget', 'confirmed', /\b(budget|trop cher|prix (trop )?(haut|eleve|bloquant)|tarif (trop )?(eleve|haut)|pas les moyens|manque de (moyens|tresorerie)|financierement)\b/],
  ['blocker', 'Budget', 'suggested', /\b(mensu|mensualite|investir|investissement|financement|tresorerie|cout|coute|cher)\b/],
  ['blocker', 'Engagé ailleurs', 'confirmed', /\b(deja (engage|signe|client)|sous contrat|contrat en cours|engagement|engage avec|prestataire actuel|agence actuelle|deja chez|solocal|pages jaunes)\b/],
  ['blocker', 'Timing', 'confirmed', /\b(pas (le bon )?moment|plus tard|reporter|attendre|recontacter|rappeler (dans|en)|fin de contrat|fin d engagement|revoir en|projet (pour|prevu))\b/],
  ['blocker', 'Décideur absent', 'confirmed', /\b(decideur|decisionnaire|associe|conjoint|gerant absent|patron absent|doit voir avec|voir avec|en parler a|doit valider|validation de)\b/]
];

function addSignal(signals, kind, label, confidence) {
  const existing = signals.find(signal => signal.kind === kind && signal.label === label);
  if (!existing) signals.push({ kind, label, confidence });
  else if (confidence === 'confirmed') existing.confidence = confidence;
}

export function classifyRdvNote(note) {
  const text = normalize(note);
  const signals = [];
  for (const [kind, label, confidence, pattern] of RULES) {
    if (pattern.test(text)) addSignal(signals, kind, label, confidence);
  }

  const hasUrgency = /\b(urgent|rapidement|vite|immediat|tout de suite|court terme)\b/.test(text);
  const hasAcquisition = /\b(clients?|prospects?|contacts?|visibilite|trafic|demandes?|leads?)\b/.test(text);
  if (hasUrgency && hasAcquisition) addSignal(signals, 'need', 'SEA', 'suggested');

  return signals.sort((a, b) => a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label));
}

export const SIGNAL_LABELS = Object.freeze({
  needs: ['GMB', 'SEO', 'SEA', 'Site internet', 'E-commerce', 'Réseaux sociaux', 'Avis / réputation'],
  blockers: ['Budget', 'Engagé ailleurs', 'Timing', 'Décideur absent']
});
