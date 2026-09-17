import { el, button, icon, badge, phoneLink, selectField, loading, errorState, fmt } from './ui.js';
import { searchLeads, filterOptions } from './data.js';
import { TERRITORIES, PRIORITIES, TEL_ISSUES, RDV_ISSUES, NEEDS, BLOCKERS, SORTS, FILTER_LABELS, PAGE_SIZE, readFilters, filterParams, rpcFilters } from './filters.js';
import { signalGroups } from './history.js';

export async function renderLeads(root, navigate, current) {
  document.title = 'Leads | Arrow';
  const state = readFilters();
  let seq = 0;
  let debounce;
  let disposed = false;
  const alive = () => !disposed && current();
  const results = el('section', { class: 'results', 'aria-label': 'Résultats de recherche' });
  const chips = el('div', { class: 'active-filters', 'aria-label': 'Filtres actifs' });
  const territoryHelp = el('p', { class: 'territory-help' });
  const count = el('span', { class: 'result-count', role: 'status' });
  const controls = el('div', { class: 'filter-grid' });
  const secondary = el('details', { class: 'extra-filters' }, el('summary', {}, 'Plus de filtres'));
  const extraControls = el('div', { class: 'filter-grid' });
  secondary.append(extraControls);
  secondary.open = Boolean(state.dept || state.status || state.priority || state.tel || state.rdv);
  const filterDisclosure = el('details', { class: 'filter-disclosure' }, el('summary', {}, 'Affiner la recherche'), controls, secondary, chips);
  const mobile = matchMedia('(max-width: 520px)');
  const adaptFilters = () => { filterDisclosure.open = !mobile.matches; };
  adaptFilters(); mobile.addEventListener('change', adaptFilters);

  function sync() {
    history.replaceState(null, '', '?' + filterParams(state));
    territoryHelp.textContent = TERRITORIES.find(item => item.id === state.sector).description;
    sectors.querySelectorAll('button').forEach(node => node.setAttribute('aria-pressed', String(node.dataset.sector === state.sector)));
    chips.replaceChildren(...Object.entries(FILTER_LABELS).filter(([key]) => state[key]).map(([key, title]) =>
      button(title + ' : ' + (state[key] === '__empty' ? 'Non renseigné' : state[key]) + ' ×', () => {
        state[key] = ''; state.page = 1; updateInputs(); load();
      }, 'filter-chip')));
  }
  function updateInputs() {
    root.querySelectorAll('[data-filter]').forEach(input => { input.value = state[input.dataset.filter]; });
  }
  function reset() {
    Object.assign(state, readFilters('')); updateInputs(); load();
  }
  const sectors = el('div', { class: 'territories', role: 'group', 'aria-label': 'Secteur géographique' },
    TERRITORIES.map(item => el('button', { type: 'button', 'data-sector': item.id, onclick: () => {
      state.sector = item.id; state.dept = ''; state.page = 1; updateInputs(); load();
    } }, item.name)));
  const search = el('input', { id: 'leadSearch', type: 'search', maxlength: '160', autocomplete: 'off',
    placeholder: 'Rechercher une entreprise, une ville, un SIREN…', 'data-filter': 'q', oninput: event => {
      state.q = event.target.value; state.page = 1;
      // Invalidate in-flight results immediately, not only after the debounce.
      seq++; sync(); clearTimeout(debounce); debounce = setTimeout(load, 300);
    } });
  search.value = state.q;
  root.replaceChildren(el('header', { class: 'page-header' }, el('div', {}, el('h1', {}, 'Trouver. Contacter. Avancer.'),
    el('p', {}, 'Les bons prospects, au bon endroit.'))),
  el('section', { class: 'filter-panel', 'aria-label': 'Recherche et filtres' }, sectors, territoryHelp,
    el('label', { class: 'search-wrap', for: 'leadSearch' }, icon('search'), el('span', { class: 'sr-only' }, 'Rechercher des leads'), search),
    filterDisclosure),
  el('div', { class: 'results-heading' }, el('div', {}, el('h2', {}, 'Vos leads'), count),
    selectField('Trier par', 'sort', SORTS, state.sort, event => { state.sort = event.target.value; state.page = 1; load(); })), results,
  el('p', { class: 'help list-help' }, 'Ouvrez une entreprise pour consulter son historique, ajouter une note ou planifier un rendez-vous.'));

  function field(title, key, values, issue = false) {
    const options = [['', 'Tous'], ...(issue ? [['__empty', 'Non renseigné']] : []), ...values.map(value => [value, value.replace(/^[^\p{L}\d]+/u, '')])];
    const label = selectField(title, key, options, state[key], event => { state[key] = event.target.value; state.page = 1; load(); });
    label.querySelector('select').dataset.filter = key;
    return label;
  }
  controls.append(field('Besoin identifié', 'need', NEEDS), field('Frein identifié', 'blocker', BLOCKERS),
    field('Issue du RDV historique', 'historyRdv', RDV_ISSUES, true));
  const optionsStatus = el('span', { class: 'help', role: 'status' }, 'Chargement des métiers et commerciaux…');
  controls.append(optionsStatus);
  const resetButton = button('Réinitialiser', reset, 'text-button'); resetButton.prepend(icon('reset'));
  controls.append(resetButton);
  async function loadOptions() {
    optionsStatus.replaceChildren('Chargement des filtres…');
    try {
      const options = await filterOptions();
      if (!alive()) return;
      const values = kind => [...new Set([...(options[kind] || []), ...(state[kind === 'profession' ? 'profession' : kind] ? [state[kind]] : [])])];
      optionsStatus.remove();
      controls.insertBefore(field('Métier', 'profession', values('profession')), resetButton);
      controls.insertBefore(field('Commercial', 'commercial', values('commercial')), resetButton);
      extraControls.replaceChildren(field('Issue téléphone actuelle', 'tel', TEL_ISSUES, true),
        field('Issue RDV actuelle', 'rdv', RDV_ISSUES, true), field('Priorité historique Arrow', 'priority', PRIORITIES),
        field('Département', 'dept', options.departement || []), field('Statut importé Arrow', 'status', options.statut || []));
    } catch {
      if (alive()) optionsStatus.replaceChildren(button('Réessayer les filtres métier / commercial', loadOptions, 'text-button'));
    }
  }
  function openLead(id) { const params = filterParams(state); params.set('lead', id); navigate(params); }
  function row(lead) {
    const params = filterParams(state); params.set('lead', lead.id);
    const link = el('a', { href: '?' + params, class: 'company-link', onclick: event => {
      if (!event.metaKey && !event.ctrlKey) { event.preventDefault(); openLead(lead.id); }
    } }, lead.societe || 'Entreprise sans nom');
    const historical = el('div', { class: 'historical-summary' },
      el('div', { class: 'historical-meta' }, badge(lead.historical_issue),
        el('span', { class: 'cell-sub' }, lead.historical_date
          ? new Date(`${lead.historical_date}T12:00:00`).toLocaleDateString('fr-FR') : lead.historical_date_text || 'Date non renseignée')),
      el('p', { class: 'history-excerpt' }, lead.historical_note || 'Aucune note d’issue RDV retrouvée.'));
    return el('tr', {},
      el('td', { 'data-label': 'Entreprise' }, link, el('span', { class: 'cell-sub' }, [lead.ville, lead.departement].filter(value => value != null && value !== '').join(' · '))),
      el('td', { 'data-label': 'Contact' }, el('span', {}, lead.profession || 'Métier non renseigné'),
        el('span', { class: 'cell-sub' }, lead.commercial || 'Sans commercial'),
        el('span', { class: 'phone-number' }, lead.telephone || 'Téléphone non renseigné'), phoneLink(lead.telephone)),
      el('td', { 'data-label': 'Suivi actuel' }, el('span', { class: 'mini-label' }, 'Tél.'), badge(lead.issue_tel),
        el('span', { class: 'mini-label second' }, 'RDV'), badge(lead.issue_rdv)),
      el('td', { 'data-label': 'Dernière issue RDV' }, historical),
      el('td', { 'data-label': 'Besoins et freins' }, signalGroups(lead.needs || [], lead.blockers || [])),
      el('td', { 'data-label': 'Notes' }, el('span', { class: 'muted' }, fmt(lead.note_count || 0)),
        el('button', { type: 'button', class: 'open-lead', 'aria-label': 'Ouvrir ' + (lead.societe || 'la fiche'), onclick: () => openLead(lead.id) }, icon('arrow'))));
  }
  async function load() {
    clearTimeout(debounce);
    const token = ++seq;
    sync(); count.textContent = 'Recherche en cours…'; results.replaceChildren(loading());
    const slow = setTimeout(() => {
      if (alive() && token === seq) count.textContent = 'Le réseau est lent, encore quelques instants…';
    }, 5000);
    try {
      const data = await searchLeads(rpcFilters(state));
      if (!alive() || token !== seq) return;
      const pages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
      if (state.page > pages) { state.page = pages; return load(); }
      count.textContent = fmt(data.total) + ' lead' + (data.total > 1 ? 's' : '');
      if (!data.rows.length) {
        results.replaceChildren(el('div', { class: 'empty-state' }, el('h2', {}, 'Aucun lead avec ces filtres'),
          el('p', {}, 'Essayez un autre secteur ou retirez un filtre.'), button('Voir tous les leads', reset, 'primary')));
        return;
      }
      const table = el('table', { class: 'lead-table' }, el('caption', { class: 'sr-only' }, 'Leads correspondant aux filtres'),
        el('thead', {}, el('tr', {}, ['Entreprise', 'Contact', 'Suivi actuel', 'Dernière issue RDV', 'Besoins / freins', 'Notes'].map(title => el('th', { scope: 'col' }, title)))),
        el('tbody', {}, data.rows.map(row)));
      const prev = button('Précédent', () => { state.page--; load(); }); prev.disabled = state.page <= 1;
      const next = button('Suivant', () => { state.page++; load(); }); next.disabled = state.page >= pages;
      results.replaceChildren(el('div', { class: 'table-wrap' }, table), el('div', { class: 'pagination' },
        el('span', { class: 'muted' }, `${fmt((state.page - 1) * PAGE_SIZE + 1)}–${fmt(Math.min(state.page * PAGE_SIZE, data.total))} sur ${fmt(data.total)}`),
        el('div', {}, prev, el('span', { class: 'page-number' }, `${state.page} / ${pages}`), next)));
    } catch {
      if (alive() && token === seq) {
        count.textContent = 'Résultats indisponibles';
        results.replaceChildren(errorState('Vérifiez votre connexion. Si le problème persiste, contactez votre direction.', load));
      }
    } finally { clearTimeout(slow); }
  }
  loadOptions(); load();
  return () => { disposed = true; seq++; clearTimeout(debounce); mobile.removeEventListener('change', adaptFilters); };
}
