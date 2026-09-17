import { el, button, loading, errorState, toast } from './ui.js';
import { getAgenda, addAgenda, setAgendaDone, me } from './data.js';

export function appointmentForm(lead, onSaved) {
  const date = el('input', { type: 'date', id: 'rdvDate', required: true });
  const time = el('input', { type: 'time', id: 'rdvTime' });
  const note = el('textarea', { id: 'rdvNote', rows: '2', maxlength: '10000', placeholder: 'Objet du rendez-vous…' });
  const error = el('p', { class: 'error-text', role: 'alert' });
  const submit = el('button', { type: 'submit', class: 'primary' }, 'Planifier le rendez-vous');
  let id = crypto.randomUUID();
  let attempted = '';
  const form = el('form', { class: 'appointment-form' },
    el('div', { class: 'issue-fields' }, el('label', {}, 'Date', date), el('label', {}, 'Heure', time)),
    el('label', { for: 'rdvNote' }, 'Note (facultatif)'), note, error, submit);
  form.addEventListener('input', () => {
    form.dataset.dirty = 'true';
    if (attempted && attempted !== JSON.stringify([date.value, time.value, note.value])) { id = crypto.randomUUID(); attempted = ''; }
  });
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (submit.disabled) return;
    if (!date.value || !date.validity.valid) { error.textContent = 'Choisissez une date valide.'; date.focus(); return; }
    error.textContent = ''; submit.disabled = true; submit.textContent = 'Enregistrement…';
    attempted = JSON.stringify([date.value, time.value, note.value]);
    [date, time, note].forEach(input => { input.disabled = true; });
    try {
      await addAgenda(lead, date.value, time.value, note.value.trim(), id);
      form.reset(); form.dataset.dirty = 'false'; id = crypto.randomUUID(); attempted = '';
      toast('Rendez-vous enregistré.'); await onSaved();
    } catch { error.textContent = 'Enregistrement non confirmé. Réessayez sans modifier la saisie pour éviter un doublon.'; }
    finally { submit.disabled = false; submit.textContent = 'Planifier le rendez-vous'; [date, time, note].forEach(input => { input.disabled = false; }); }
  });
  return form;
}

export function appointmentDate(entry) {
  return new Date(entry.date_rdv + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) + (entry.heure_rdv ? ' · ' + entry.heure_rdv : '');
}

export function appointmentAction(entry, onSaved) {
  if (entry.owner_id !== me()?.id && me()?.role !== 'directeur') return el('span', { class: 'help' }, 'Géré par un collègue');
  const action = button(entry.disabled ? 'Réactiver' : 'Marquer terminé', async () => {
    action.disabled = true;
    try { await setAgendaDone(entry.id, !entry.disabled); toast('Rendez-vous mis à jour.'); await onSaved(); }
    catch { toast('Mise à jour impossible. Réessayez.', true); }
    finally { action.disabled = false; }
  });
  return action;
}

export async function renderLeadAppointments(container, leadId, current) {
  container.replaceChildren(loading());
  let page = 0;
  async function load(append = false) {
    try {
      const entries = await getAgenda(page, leadId);
      if (!current()) return;
      if (!append) container.replaceChildren();
      container.querySelector('.load-more')?.remove();
      if (!entries.length && !append) container.append(el('p', { class: 'muted' }, 'Aucun rendez-vous planifié.'));
      entries.forEach(entry => container.append(el('article', { class: 'appointment-small' },
        el('strong', {}, appointmentDate(entry)), el('p', { class: 'muted' }, entry.disabled ? 'Terminé / désactivé' : 'Planifié'),
        el('p', { class: 'preserve-lines' }, entry.note_rdv || ''), appointmentAction(entry, () => { page = 0; return load(); }))));
      if (entries.length === 50) container.append(button('Voir la suite', event => {
        event.currentTarget.disabled = true; page++; load(true);
      }, 'load-more'));
    } catch {
      if (current()) container.append(errorState('Impossible de lire les rendez-vous.', () => { page = 0; return load(); }));
    }
  }
  await load();
}
