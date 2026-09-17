import { el, button, phoneLink, loading, errorState } from './ui.js';
import { getAgenda } from './data.js';
import { appointmentDate, appointmentAction } from './appointments.js';

export async function renderAgenda(root, navigate, current) {
  let disposed = false;
  let page = 0;
  let seq = 0;
  const params = new URLSearchParams(location.search);
  page = Math.max(0, (parseInt(params.get('agendaPage'), 10) || 1) - 1);
  const list = el('section', { class: 'agenda-list', 'aria-label': 'Rendez-vous de l’équipe' });
  document.title = 'Agenda | Arrow';
  root.replaceChildren(el('header', { class: 'page-header' }, el('div', {}, el('h1', {}, 'Vos rendez-vous.'),
    el('p', {}, 'Le planning partagé de votre équipe. Planifiez un rendez-vous depuis une fiche lead.'))), list);
  async function load() {
    const version = ++seq;
    params.set('agendaPage', page + 1); history.replaceState(null, '', '?' + params);
    list.replaceChildren(loading());
    try {
      const entries = await getAgenda(page);
      if (disposed || !current() || version !== seq) return;
      if (!entries.length && page > 0) { page--; return load(); }
      const cards = entries.map(entry => {
        const company = entry.lead_id ? button(entry.societe || 'Ouvrir le lead', () => {
          const target = new URLSearchParams(location.search); target.set('lead', entry.lead_id); navigate(target);
        }, 'company-link') : el('strong', {}, entry.societe || 'Lead indisponible');
        return el('article', { class: 'agenda-card' }, el('div', { class: 'agenda-date' }, appointmentDate(entry),
          el('span', { class: 'cell-sub' }, entry.disabled ? 'Terminé / désactivé' : 'Planifié')),
          el('div', { class: 'agenda-content' }, company, el('p', { class: 'muted' }, entry.ville || '', ' · ', entry.commercial || 'Sans commercial'),
            el('p', { class: 'preserve-lines' }, entry.note_rdv || '')),
          el('div', { class: 'agenda-actions' }, phoneLink(entry.telephone), appointmentAction(entry, load)));
      });
      const previous = button('Précédent', () => { page--; load(); }); previous.disabled = page === 0;
      const next = button('Suivant', () => { page++; load(); }); next.disabled = entries.length < 50;
      list.replaceChildren(...cards, el('div', { class: 'pagination' }, previous, `Page ${page + 1}`, next));
      if (!entries.length) list.prepend(el('div', { class: 'empty-state' }, el('h2', {}, 'Votre agenda est disponible'),
        el('p', {}, 'Ouvrez une fiche lead pour planifier votre premier rendez-vous.'), button('Retrouver un lead', () => navigate(new URLSearchParams()), 'primary')));
    } catch { if (!disposed && current()) list.replaceChildren(errorState('Le planning ne peut pas être chargé.', load)); }
  }
  load();
  return () => { disposed = true; seq++; };
}
