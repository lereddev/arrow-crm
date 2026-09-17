import { el, button, phoneLink, loading, errorState } from './ui.js';
import { getAgenda } from './data.js';
import { appointmentDate, appointmentAction } from './appointments.js';
import { NAMED_DEPARTMENTS, TERRITORIES } from './filters.js';

export async function renderAgenda(root, navigate, current) {
  let disposed = false;
  let page = 0;
  let seq = 0;
  const params = new URLSearchParams(location.search);
  let sector = TERRITORIES.find(item => item.id === params.get('agendaSector')) || TERRITORIES[0];
  page = Math.max(0, (parseInt(params.get('agendaPage'), 10) || 1) - 1);
  const list = el('section', { class: 'agenda-list', 'aria-label': 'Rendez-vous de l’équipe' });
  document.title = 'Agenda | Arrow';
  const tabs = el('div', { class: 'territories agenda-tabs', role: 'group', 'aria-label': 'Agenda par région' },
    TERRITORIES.map(item => button(item.name, () => {
      sector = item; page = 0; load();
    })));
  root.replaceChildren(el('header', { class: 'page-header' }, el('div', {}, el('h1', {}, 'Agenda par région'),
    el('p', {}, 'Tous les agendas sont partagés. Choisissez une région pour organiser vos rendez-vous.'))),
  el('section', { class: 'agenda-toolbar', 'aria-label': 'Choisir une région' }, tabs), list);
  async function load() {
    const version = ++seq;
    if (sector.id) params.set('agendaSector', sector.id); else params.delete('agendaSector');
    params.set('agendaPage', page + 1); history.replaceState(null, '', '?' + params);
    tabs.querySelectorAll('button').forEach((node, index) => node.setAttribute('aria-pressed', String(TERRITORIES[index].id === sector.id)));
    list.replaceChildren(loading());
    try {
      const entries = await getAgenda(page, null, sector.departments, sector.outside ? NAMED_DEPARTMENTS : []);
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
      if (!entries.length) list.prepend(el('div', { class: 'empty-state' }, el('h2', {}, `Aucun rendez-vous · ${sector.name}`),
        el('p', {}, 'Ouvrez une fiche lead pour planifier un rendez-vous dans cette région.'), button('Retrouver un lead', () => navigate(new URLSearchParams()), 'primary')));
    } catch { if (!disposed && current()) list.replaceChildren(errorState('Le planning ne peut pas être chargé.', load)); }
  }
  load();
  return () => { disposed = true; seq++; };
}
