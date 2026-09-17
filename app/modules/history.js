import { getRdvHistory } from './data.js';
import { el, button, badge, loading, errorState } from './ui.js';

export function signalTag(signal) {
  const suggested = signal.confidence === 'suggested';
  return el('span', { class: `signal-tag ${signal.kind} ${suggested ? 'suggested' : ''}` },
    suggested ? `À qualifier · peut-être ${signal.label}` : signal.label);
}

export function signalGroups(needs = [], blockers = []) {
  const tags = [
    ...needs.map(signal => signalTag({ ...signal, kind: 'need' })),
    ...blockers.map(signal => signalTag({ ...signal, kind: 'blocker' }))
  ];
  return el('div', { class: 'signal-list', 'aria-label': 'Besoins et freins identifiés' },
    tags.length ? tags : el('span', { class: 'muted' }, 'Aucun besoin classé'));
}

function formatHistoryDate(entry) {
  if (entry.occurred_on) return new Date(`${entry.occurred_on}T12:00:00`).toLocaleDateString('fr-FR', { dateStyle: 'medium' });
  return entry.date_rdv_text || entry.source_period;
}

function historyCard(entry) {
  const signals = entry.rdv_signals || [];
  return el('article', { class: 'history-card' },
    el('div', { class: 'history-heading' },
      el('div', {}, badge(entry.issue_rdv || 'Issue non renseignée'),
        el('time', { datetime: entry.occurred_on || '' }, formatHistoryDate(entry))),
      entry.commercial ? el('span', { class: 'muted' }, entry.commercial) : null),
    entry.confirmation_rdv ? el('p', { class: 'history-confirmation' }, 'Confirmation téléphone : ', entry.confirmation_rdv) : null,
    signalGroups(signals.filter(signal => signal.kind === 'need'), signals.filter(signal => signal.kind === 'blocker')),
    el('p', { class: 'history-note preserve-lines' }, entry.note_issue_rdv || 'Aucune note d’issue pour ce rendez-vous.'));
}

export function historyPanel(leadId, current) {
  const section = el('section', { class: 'panel history-panel' },
    el('div', { class: 'section-heading' }, el('div', {}, el('h2', {}, 'Historique des rendez-vous'),
      el('p', { class: 'muted' }, 'Issues et notes originales importées depuis les fichiers Arrow.'))));
  const list = el('div', { class: 'history-list' }, loading());
  section.append(list);
  let page = 0;

  async function load(append = false) {
    if (!append) { page = 0; list.replaceChildren(loading()); }
    try {
      const rows = await getRdvHistory(leadId, page);
      if (!current()) return;
      if (!append) list.replaceChildren();
      list.querySelector('.load-more')?.remove();
      if (!rows.length && !append) list.append(el('div', { class: 'history-empty' },
        el('strong', {}, 'Aucun rendez-vous historique retrouvé'),
        el('p', { class: 'muted' }, 'Le suivi actuel et les notes de l’équipe restent disponibles ci-dessous.')));
      rows.forEach(entry => list.append(historyCard(entry)));
      if (rows.length === 50) list.append(button('Voir les rendez-vous plus anciens', event => {
        event.currentTarget.disabled = true; page++; load(true);
      }, 'load-more'));
    } catch {
      if (current()) {
        if (append) page--;
        list.append(errorState('L’historique des rendez-vous ne peut pas être chargé.', () => load()));
      }
    }
  }
  load();
  return section;
}
