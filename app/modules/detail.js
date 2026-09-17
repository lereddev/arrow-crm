import { el, button, icon, badge, phoneLink, selectField, loading, errorState, toast } from './ui.js';
import { getLead, getIssues, saveIssues, getNotes, saveNote } from './data.js';
import { TEL_ISSUES, RDV_ISSUES } from './filters.js';
import { appointmentForm, renderLeadAppointments } from './appointments.js';
import { historyPanel } from './history.js';

export async function renderDetail(root, id, navigate, current) {
  let disposed = false;
  const alive = () => current() && !disposed;
  const dispose = () => { disposed = true; };
  const params = new URLSearchParams(location.search); params.delete('lead');
  const back = button('Retour à la liste', () => navigate(params), 'text-button'); back.prepend(icon('back'));
  root.replaceChildren(back, loading());
  if (!/^\d{1,16}$/.test(id)) {
    root.replaceChildren(back, el('div', { class: 'empty-state' }, el('h1', {}, 'Fiche introuvable'))); return dispose;
  }
  let lead;
  try { lead = await getLead(id); }
  catch {
    if (alive()) root.replaceChildren(back, errorState('Fiche introuvable ou accès indisponible.', () => renderDetail(root, id, navigate, current)));
    return dispose;
  }
  if (!alive()) return dispose;
  document.title = (lead.societe || 'Fiche lead') + ' | Arrow';
  const details = el('dl', { class: 'contact-details' });
  for (const [title, value] of [['Adresse', lead.adresse], ['Ville', lead.ville], ['Département', lead.departement], ['Métier', lead.profession], ['Commercial', lead.commercial]]) {
    details.append(el('div', {}, el('dt', {}, title), el('dd', {}, value == null || value === '' ? 'Non renseigné' : String(value))));
  }
  const siren = el('a', { href: 'https://www.societe.com/cgi-bin/search?champs=' + encodeURIComponent(lead.siren), target: '_blank', rel: 'noopener noreferrer', class: 'siren-link' }, lead.siren, icon('external'));
  details.append(el('div', {}, el('dt', {}, 'SIREN · Société.com'), el('dd', {}, siren)));
  const issues = el('section', { class: 'panel' }, el('h2', {}, 'Suivi actuel'),
    el('p', { class: 'muted section-intro' }, 'Issues saisies par l’équipe après les nouveaux appels et rendez-vous.'), loading());
  const notes = el('section', { class: 'panel notes-panel' }, el('h2', {}, 'Notes de l’équipe'),
    el('p', { class: 'muted' }, 'Chaque note est conservée séparément et partagée avec votre équipe.'));
  const textarea = el('textarea', { id: 'newNote', rows: '4', maxlength: '10000', placeholder: 'Compte rendu d’appel, besoin identifié, prochaine étape…' });
  const noteError = el('p', { class: 'error-text', role: 'alert' });
  const submit = el('button', { type: 'submit', class: 'primary' }, 'Enregistrer la note');
  const form = el('form', {}, el('label', { for: 'newNote' }, 'Ajouter une note'), textarea, noteError, submit);
  let noteId = crypto.randomUUID();
  let failedText = null;
  textarea.addEventListener('input', () => {
    form.dataset.dirty = String(Boolean(textarea.value));
    if (failedText !== null && failedText !== textarea.value.trim()) { noteId = crypto.randomUUID(); failedText = null; }
  });
  const list = el('div', { class: 'notes-list' });
  let notesPage = 0;
  async function loadNotes(append = false) {
    if (!append) { notesPage = 0; list.replaceChildren(loading()); }
    try {
      const rows = await getNotes(id, notesPage);
      if (!alive()) return;
      if (!append) list.replaceChildren();
      if (!rows.length && !append) list.append(el('p', { class: 'muted' }, 'Aucune note pour le moment. Commencez le suivi ci-dessus.'));
      rows.forEach(note => list.append(el('article', { class: 'note' },
        el('div', { class: 'note-meta' }, el('strong', {}, note.app_users?.nom || 'Membre de l’équipe'),
          el('time', { datetime: note.created_at }, new Date(note.created_at).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }))),
        el('p', { class: 'preserve-lines' }, note.text))));
      list.querySelector('.load-more')?.remove();
      if (rows.length === 50) list.append(button('Notes plus anciennes', event => {
        event.currentTarget.disabled = true; notesPage++; loadNotes(true);
      }, 'load-more'));
    } catch {
      if (alive()) {
        if (append) notesPage--;
        list.append(errorState('Les notes ne sont pas disponibles. Votre saisie reste conservée sur cette page.', () => loadNotes()));
      }
    }
  }
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (submit.disabled) return;
    noteError.textContent = '';
    if (!textarea.value.trim()) { noteError.textContent = 'Saisissez une note avant de l’enregistrer.'; textarea.focus(); return; }
    submit.disabled = true; textarea.readOnly = true; submit.textContent = 'Enregistrement…';
    const text = textarea.value.trim();
    try {
      await saveNote(lead.id, text, noteId);
      if (!alive()) return;
      textarea.value = ''; form.dataset.dirty = 'false'; noteId = crypto.randomUUID(); failedText = null;
      toast('Note enregistrée.'); await loadNotes();
    } catch {
      failedText = text;
      if (alive()) noteError.textContent = 'Enregistrement non confirmé. Votre texte est conservé : réessayez sans le modifier pour éviter un doublon.';
    } finally { submit.disabled = false; textarea.readOnly = false; submit.textContent = 'Enregistrer la note'; }
  });
  notes.append(form, list);
  const history = el('details', { class: 'panel imported-history' }, el('summary', {}, 'Historique importé d’Arrow'),
    el('p', { class: 'help' }, 'Cet historique est distinct du suivi saisi dans le CRM.'),
    el('p', {}, 'Statut importé : ', lead.statut || 'Non renseigné'),
    el('p', {}, 'Dernier RDV importé : ', lead.date_rdv || 'Non renseigné'),
    el('p', {}, `RDV : ${lead.nb_rdvs || 0} · Audits : ${lead.nb_audits || 0}`),
    el('p', {}, 'Périodes : ', lead.premiere_periode || '—', ' → ', lead.derniere_periode || '—'),
    el('p', { class: 'preserve-lines' }, lead.notes || 'Aucune note importée.'));
  const appointments = el('section', { class: 'panel' }, el('h2', {}, 'Rendez-vous'));
  const appointmentList = el('div');
  appointments.append(appointmentList, appointmentForm(lead, () => renderLeadAppointments(appointmentList, lead.id, alive)));
  const rdvHistory = historyPanel(lead.id, alive);
  root.replaceChildren(back, el('header', { class: 'detail-header' },
    el('div', {}, el('h1', {}, lead.societe || 'Entreprise sans nom'), el('p', {}, lead.profession || '', ' · ', lead.ville || ''),
      el('span', { class: 'historical-priority' }, 'Priorité Arrow : ', badge(lead.priorite))), phoneLink(lead.telephone)),
    el('div', { class: 'detail-layout' }, el('div', { class: 'detail-main' }, rdvHistory, issues, notes, history),
      el('aside', { class: 'detail-aside' }, el('section', { class: 'panel' }, el('h2', {}, 'Coordonnées'), el('p', {}, lead.telephone || 'Téléphone non renseigné'), details), appointments)));
  async function loadIssues() {
    issues.replaceChildren(el('h2', {}, 'Suivi actuel'),
      el('p', { class: 'muted section-intro' }, 'Issues saisies par l’équipe après les nouveaux appels et rendez-vous.'), loading());
    try {
      const stored = await getIssues(id) || { issue_tel: '', issue_rdv: '' };
      if (!alive()) return;
      const options = (values, value) => [['', 'Non renseigné'], ...[...new Set([...values, ...(value ? [value] : [])])].map(item => [item, item])];
      const tel = selectField('Issue téléphone', 'issueTel', options(TEL_ISSUES, stored.issue_tel), stored.issue_tel);
      const rdv = selectField('Issue RDV', 'issueRdv', options(RDV_ISSUES, stored.issue_rdv), stored.issue_rdv);
      const save = el('button', { type: 'submit', class: 'primary' }, 'Enregistrer le suivi');
      const error = el('p', { class: 'error-text', role: 'alert' });
      const issueForm = el('form', {}, el('div', { class: 'issue-fields' }, tel, rdv), error, save);
      issueForm.addEventListener('change', () => { issueForm.dataset.dirty = 'true'; });
      issueForm.addEventListener('submit', async event => {
        event.preventDefault(); if (save.disabled) return;
        save.disabled = true; error.textContent = ''; save.textContent = 'Enregistrement…';
        const selects = issueForm.querySelectorAll('select'); selects.forEach(node => { node.disabled = true; });
        try {
          await saveIssues(lead.id, selects[0].value, selects[1].value);
          issueForm.dataset.dirty = 'false'; toast('Suivi enregistré.');
        } catch { error.textContent = 'Le suivi n’a pas pu être confirmé. Réessayez.'; }
        finally { save.disabled = false; save.textContent = 'Enregistrer le suivi'; selects.forEach(node => { node.disabled = false; }); }
      });
      issues.replaceChildren(el('h2', {}, 'Suivi actuel'),
        el('p', { class: 'muted section-intro' }, 'Issues saisies par l’équipe après les nouveaux appels et rendez-vous.'), issueForm);
    } catch { if (alive()) issues.replaceChildren(errorState('Le suivi ne peut pas être chargé.', loadIssues)); }
  }
  loadIssues(); loadNotes(); renderLeadAppointments(appointmentList, lead.id, alive);
  return dispose;
}
