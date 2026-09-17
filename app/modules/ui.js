// Create text nodes, never interpolate customer data into HTML.
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (value !== false && value != null) node.setAttribute(key, value === true ? '' : String(value));
  }
  node.append(...children.flat().filter(child => child != null));
  return node;
}

const paths = {
  search: ['m21 21-4.35-4.35', 'M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0'],
  users: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0', 'M22 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75'],
  calendar: ['M8 2v4m8-4v4M3 10h18', 'M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2'],
  phone: ['M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.2 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.96.35 1.9.69 2.79a2 2 0 0 1-.45 2.11L8.09 9.89a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.89.34 1.83.57 2.79.69A2 2 0 0 1 22 16.92z'],
  arrow: ['m9 18 6-6-6-6'],
  back: ['m12 19-7-7 7-7', 'M5 12h14'],
  external: ['M15 3h6v6', 'M10 14 21 3', 'M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5'],
  reset: ['M3 11a9 9 0 1 1 2.39 6.13', 'M3 3v8h8']
};
export function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.7', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', class: 'icon' })) svg.setAttribute(key, value);
  for (const d of paths[name] || paths.arrow) {
    const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', d); svg.append(path);
  }
  return svg;
}

export const fmt = value => new Intl.NumberFormat('fr-FR').format(value);
export function button(text, action, className = '') { return el('button', { type: 'button', class: className, onclick: action }, text); }
export function errorState(message, retry) {
  return el('div', { class: 'empty-state', role: 'alert' }, el('h2', {}, 'Impossible de charger'), el('p', {}, message), button('Réessayer', retry, 'primary'));
}
export function loading() {
  return el('div', { class: 'skeleton', role: 'status', 'aria-label': 'Chargement en cours' },
    el('span', {}, 'Chargement…'), ...Array.from({ length: 5 }, () => el('div', { class: 'skeleton-row' })));
}
export function badge(value) {
  const text = value || 'Non renseigné';
  let tone = 'neutral';
  if (/Chaud|rappeler|Reporté|repositionner/i.test(text)) tone = 'amber';
  if (/Signé|Réalisé|Confirmé|Client/i.test(text)) tone = 'green';
  if (/Tiède|positionné|Répondeur/i.test(text)) tone = 'blue';
  if (/Refus|Hors cible|Annulé|Exclu|Lapin/i.test(text)) tone = 'red';
  return el('span', { class: 'badge ' + tone }, text.replace(/^[^\p{L}]+/u, ''));
}
export function phoneLink(phone) {
  const number = String(phone || '').replace(/[^+\d]/g, '');
  return number ? el('a', { href: 'tel:' + number, class: 'call-button', 'aria-label': 'Appeler le ' + phone }, icon('phone'), 'Appeler') : el('span', { class: 'muted' }, 'Sans numéro');
}
export function selectField(label, name, options, value = '', onChange) {
  const select = el('select', { id: name, name, onchange: onChange }, options.map(([key, title]) => el('option', { value: key }, title)));
  select.value = value;
  return el('label', { class: 'filter-field', for: name }, el('span', {}, label), select);
}
let toastTimer;
export function toast(text, error = false) {
  const node = document.getElementById('toast');
  clearTimeout(toastTimer);
  node.textContent = text; node.className = 'toast' + (error ? ' toast-error' : ''); node.hidden = false;
  toastTimer = setTimeout(() => { node.hidden = true; }, error ? 10000 : 3500);
}
