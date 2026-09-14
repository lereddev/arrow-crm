// ═══════════════════════════════════════════════
//  ACCÈS AUX DONNÉES
//
//  Tout passe par Supabase sous Row Level Security : le navigateur
//  n'a jamais la main sur plus que ce que les policies autorisent.
//  La clé publiée ici est la clé « anon » ; elle est conçue pour être
//  publique et n'ouvre rien par elle-même.
// ═══════════════════════════════════════════════
const CFG = window.ARROW_CONFIG || {};
let _sb = null;
let SESSION = null;     // session Supabase courante
let ME = null;          // ligne app_users de l'utilisateur connecté

function sb() {
  if (!_sb) {
    if (!CFG.supabaseUrl || !CFG.supabaseAnonKey) return null;
    _sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
  }
  return _sb;
}

const isConfigured = () => Boolean(CFG.supabaseUrl && CFG.supabaseAnonKey);

// ── Retour d'erreur visible ──────────────────────────────────────
// Une opération qui échoue le dit. Pas de sauvegarde silencieuse qui
// n'a jamais eu lieu.
let _toastTimer = null;
function toast(message, kind) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.className = 'toast visible' + (kind === 'error' ? ' toast-error' : '');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { el.className = 'toast'; }, kind === 'error' ? 7000 : 3000);
}

function failed(action, error) {
  const detail = error && error.message ? error.message : 'erreur inconnue';
  console.error('[arrow] ' + action, error);
  toast(action + ' : ' + detail, 'error');
  return null;
}

// ── Authentification ─────────────────────────────────────────────
async function sendMagicLink(email) {
  const client = sb();
  if (!client) return { ok: false, message: "L'application n'est pas configurée." };

  const { error } = await client.auth.signInWithOtp({
    email: email,
    options: {
      // Décisif : sans cette option, saisir une adresse inconnue
      // créerait le compte. L'accès se fait sur invitation uniquement.
      shouldCreateUser: false,
      emailRedirectTo: window.location.origin + window.location.pathname
    }
  });

  if (error) {
    const known = /not.*(allowed|found)|signups? not allowed|invalid/i.test(error.message || '');
    return {
      ok: false,
      message: known
        ? "Cette adresse n'a pas accès à l'application. Demandez une invitation."
        : 'Envoi impossible : ' + error.message
    };
  }
  return { ok: true, message: 'Lien envoyé. Ouvrez votre boîte mail et cliquez dessus.' };
}

async function signOut() {
  const client = sb();
  if (client) await client.auth.signOut();
  SESSION = null;
  ME = null;
  window.location.reload();
}

async function loadProfile() {
  const { data, error } = await sb().from('app_users').select('*').eq('id', SESSION.user.id).single();
  if (error) return null;
  return data;
}

// ── Leads ────────────────────────────────────────────────────────
// Cache des lignes déjà affichées : la fiche détaillée s'ouvre sans
// aller-retour quand le lead vient d'être listé.
const LEAD_CACHE = new Map();

function cacheLeads(rows) {
  rows.forEach(r => LEAD_CACHE.set(r.id, r));
}

async function fetchLeadPage(tabId) {
  const tab = STATE.tabs[tabId];
  const { data, error } = await sb().rpc('search_leads', {
    p_priorite:    tab.priorite,
    p_search:      tab.search || null,
    p_departement: tab.dept ? Number(tab.dept) : null,
    p_profession:  tab.prof || null,
    p_commercial:  tab.commercial || null,
    p_statut:      tab.statut || null,
    p_sort:        tab.sortCol || null,
    p_dir:         tab.sortDir === -1 ? 'desc' : 'asc',
    p_limit:       PAGE_SIZE,
    p_offset:      (tab.page - 1) * PAGE_SIZE
  });

  if (error) { failed('Chargement des leads', error); return null; }

  cacheLeads(data);
  // `total_count` est identique sur toutes les lignes de la page ;
  // une page vide signifie zéro résultat.
  return { rows: data, total: data.length ? Number(data[0].total_count) : 0 };
}

async function fetchLead(id) {
  if (LEAD_CACHE.has(id)) return LEAD_CACHE.get(id);
  const { data, error } = await sb().from('leads').select('*').eq('id', id).single();
  if (error) return failed('Chargement de la fiche', error);
  LEAD_CACHE.set(id, data);
  return data;
}

async function fetchFilterOptions(priorite) {
  const { data, error } = await sb().rpc('lead_filter_options', { p_priorite: priorite });
  if (error) { failed('Chargement des filtres', error); return { departement: [], profession: [], commercial: [], statut: [] }; }
  const out = { departement: [], profession: [], commercial: [], statut: [] };
  data.forEach(r => { if (out[r.kind]) out[r.kind].push(r.value); });
  return out;
}

// ── Notes ────────────────────────────────────────────────────────
async function dbLoadNotes(leadId) {
  const { data, error } = await sb()
    .from('lead_notes')
    .select('id, text, created_at, author_id, app_users(nom)')
    .eq('lead_id', leadId)
    .order('created_at', { ascending: true });

  if (error) { failed('Chargement des notes', error); return []; }
  return data.map(r => ({
    id: r.id,
    date: r.created_at,
    text: r.text,
    author: (r.app_users && r.app_users.nom) || '',
    mine: r.author_id === SESSION.user.id
  }));
}

async function dbSaveNote(leadId, text) {
  const { data, error } = await sb()
    .from('lead_notes')
    .insert({ lead_id: leadId, author_id: SESSION.user.id, text: text })
    .select('id, text, created_at')
    .single();

  if (error) return failed('Enregistrement de la note', error);
  toast('Note enregistrée.');
  return { id: data.id, date: data.created_at, text: data.text, author: ME ? ME.nom : '', mine: true };
}

async function dbDeleteNote(noteId) {
  const { error } = await sb().from('lead_notes').delete().eq('id', noteId);
  if (error) { failed('Suppression de la note', error); return false; }
  toast('Note supprimée.');
  return true;
}

// ── Statuts téléphone / rendez-vous ──────────────────────────────
async function dbLoadIssues(leadId) {
  const { data, error } = await sb()
    .from('lead_issues').select('issue_tel, issue_rdv').eq('lead_id', leadId).maybeSingle();
  if (error) { failed('Chargement des statuts', error); return { issue_tel: '', issue_rdv: '' }; }
  return data || { issue_tel: '', issue_rdv: '' };
}

async function dbSaveIssues(leadId, issueTel, issueRdv) {
  const { error } = await sb().from('lead_issues').upsert({
    lead_id: leadId,
    issue_tel: issueTel || '',
    issue_rdv: issueRdv || '',
    updated_by: SESSION.user.id,
    updated_at: new Date().toISOString()
  }, { onConflict: 'lead_id' });

  if (error) { failed('Enregistrement des statuts', error); return false; }
  const cached = LEAD_CACHE.get(leadId);
  if (cached) { cached.issue_tel = issueTel || ''; cached.issue_rdv = issueRdv || ''; }
  toast('Statuts enregistrés.');
  return true;
}

// ── Agenda ───────────────────────────────────────────────────────
async function dbLoadAgenda() {
  const { data, error } = await sb()
    .from('agenda').select('*').order('date_rdv', { ascending: true });
  if (error) { failed('Chargement de l’agenda', error); return []; }
  return data;
}

async function dbAddAgenda(lead, dateRdv, heureRdv, noteRdv) {
  const { data, error } = await sb().from('agenda').insert({
    lead_id: lead.id,
    owner_id: SESSION.user.id,
    siren: lead.siren || null,
    societe: lead.societe || null,
    priorite: lead.priorite || null,
    telephone: lead.telephone || null,
    commercial: lead.commercial || null,
    departement: lead.departement === null || lead.departement === undefined ? null : String(lead.departement),
    ville: lead.ville || null,
    date_rdv: dateRdv,
    heure_rdv: heureRdv || null,
    note_rdv: noteRdv || ''
  }).select('*').single();

  if (error) return failed('Ajout au planning', error);
  toast('Rendez-vous ajouté au planning.');
  return data;
}

async function dbSetAgendaDisabled(entryId, disabled) {
  const { error } = await sb().from('agenda').update({ disabled: disabled }).eq('id', entryId);
  if (error) { failed('Mise à jour du planning', error); return false; }
  return true;
}

async function dbDisableAgenda(entryId) { return dbSetAgendaDisabled(entryId, true); }
async function dbEnableAgenda(entryId)  { return dbSetAgendaDisabled(entryId, false); }

async function dbRemoveAgenda(entryId) {
  const { error } = await sb().from('agenda').delete().eq('id', entryId);
  if (error) { failed('Suppression du rendez-vous', error); return false; }
  toast('Rendez-vous supprimé.');
  return true;
}

// ── Tableau de bord ──────────────────────────────────────────────
async function fetchDashboard() {
  const client = sb();
  const [prio, dept, prof, statut, totals] = await Promise.all([
    client.from('v_stats_priorite').select('*'),
    client.from('v_stats_departement').select('*').limit(15),
    client.from('v_stats_profession').select('*').limit(15),
    client.from('v_stats_statut').select('*'),
    client.rpc('dashboard_totals')
  ]);

  const firstError = [prio, dept, prof, statut, totals].find(r => r.error);
  if (firstError) return failed('Chargement du tableau de bord', firstError.error);

  return {
    priorite:    prio.data,
    departement: dept.data,
    profession:  prof.data,
    statut:      statut.data,
    totals:      (totals.data && totals.data[0]) || { total_leads: 0, total_rdvs: 0, total_audits: 0, total_agenda: 0 }
  };
}

const STATE = {
  currentTab: 'dashboard',
  tabs: {
    chaud:  { priorite: '🔥 Chaud',  sorted: [], total: 0, page: 1, search: '', dept: '', prof: '', commercial: '', statut: '', sortCol: '', sortDir: 1 },
    tiede:  { priorite: '⭐ Tiède',  sorted: [], total: 0, page: 1, search: '', dept: '', prof: '', commercial: '', statut: '', sortCol: '', sortDir: 1 },
    froid:  { priorite: '❄️ Froid',  sorted: [], total: 0, page: 1, search: '', dept: '', prof: '', commercial: '', statut: '', sortCol: '', sortDir: 1 },
    client: { priorite: '🔄 Client', sorted: [], total: 0, page: 1, search: '', dept: '', prof: '', commercial: '', statut: '', sortCol: '', sortDir: 1 },
    exclu:  { priorite: '🚫 Exclu',  sorted: [], total: 0, page: 1, search: '', dept: '', prof: '', commercial: '', statut: '', sortCol: '', sortDir: 1 },
  }
};

const PAGE_SIZE = 50;

// ═══════════════════════════════════════════════
//  UTILS
// ═══════════════════════════════════════════════
function fmt(n) {
  if (n === null || n === undefined || n === '') return '—';
  return String(n);
}

function fmtNum(n) {
  return new Intl.NumberFormat('fr-FR').format(n);
}

function priorityClass(p) {
  if (!p) return '';
  if (p.includes('Chaud')) return 'hot';
  if (p.includes('Tiède')) return 'warm';
  if (p.includes('Froid')) return 'cold';
  if (p.includes('Client')) return 'client';
  if (p.includes('Exclu')) return 'exclu';
  return '';
}

function badgeHtml(p) {
  const cls = priorityClass(p);
  return `<span class="badge badge-${cls}">${p || '—'}</span>`;
}

function statutPill(s) {
  if (!s) return '<span class="field-value muted">—</span>';
  let cls = '';
  const sl = s.toLowerCase();
  if (sl.includes('confirmé') && sl.includes('r2')) cls = 'r2';
  else if (sl.includes('confirmé')) cls = 'confirme';
  else if (sl.includes('signé')) cls = 'signe';
  else if (sl.includes('injoignable')) cls = 'injoignable';
  else if (sl.includes('hors cible')) cls = 'horscible';
  else if (sl.includes('lapin') || sl.includes('autre')) cls = 'lapin';
  return `<span class="pill pill-${cls}">${s}</span>`;
}

function sanitize(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ═══════════════════════════════════════════════
//  TAB SWITCHING
// ═══════════════════════════════════════════════
function switchTab(tabId) {
  STATE.currentTab = tabId;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === 'tab-' + tabId));

  if (tabId === 'agenda') {
    renderAgendaTab();
  } else if (tabId !== 'dashboard') {
    ensureTabLoaded(tabId);
  }
}

document.getElementById('mainNav').addEventListener('click', e => {
  const btn = e.target.closest('.tab-btn');
  if (btn) switchTab(btn.dataset.tab);
});

// ═══════════════════════════════════════════════
//  DATA LOADING
// ═══════════════════════════════════════════════
// ═══════════════════════════════════════════════
//  CHARGEMENT DES ONGLETS — pagination côté serveur
//
//  L'application ne télécharge jamais le fichier de prospection en
//  entier : chaque onglet demande une page de 50 lignes, filtrée et
//  triée en base.
// ═══════════════════════════════════════════════
const tabLoaded = { chaud: false, tiede: false, froid: false, client: false, exclu: false };

async function ensureTabLoaded(tabId) {
  if (tabLoaded[tabId]) return;
  const container = document.getElementById('content-' + tabId);
  if (!container) return;

  container.innerHTML = loadingHtml();

  const options = await fetchFilterOptions(STATE.tabs[tabId].priorite);
  const tab = STATE.tabs[tabId];
  tab._depts   = options.departement;
  tab._profs   = options.profession;
  tab._comms   = options.commercial;
  tab._statuts = options.statut;

  initTab(tabId);
  tabLoaded[tabId] = true;
  await applyFilters(tabId);
}

// Empêche une réponse lente de venir écraser l'affichage d'une
// recherche plus récente : seule la dernière requête lancée compte.
const _requestSeq = {};

async function applyFilters(tabId) {
  const tab = STATE.tabs[tabId];
  const seq = (_requestSeq[tabId] = (_requestSeq[tabId] || 0) + 1);

  const tbody = document.getElementById('tbody-' + tabId);
  if (tbody) {
    tbody.innerHTML = '<tr><td colspan="11"><div class="empty-state">'
      + '<div class="empty-icon">⏳</div><div class="empty-text">Chargement…</div></div></td></tr>';
  }

  const result = await fetchLeadPage(tabId);
  if (seq !== _requestSeq[tabId]) return;  // une requête plus récente a pris la main

  if (!result) {
    tab.sorted = [];
    tab.total = 0;
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="11"><div class="empty-state">'
        + '<div class="empty-icon">⚠️</div><div class="empty-text">Chargement impossible</div>'
        + '<div class="empty-sub">Vérifiez votre connexion, puis réessayez.</div></div></td></tr>';
    }
    renderPagination(tabId);
    return;
  }

  tab.sorted = result.rows;
  tab.total  = result.total;

  // Si un filtre vient de réduire le résultat sous la page courante,
  // on recule plutôt que d'afficher une page vide.
  const lastPage = Math.max(1, Math.ceil(tab.total / PAGE_SIZE));
  if (tab.page > lastPage) { tab.page = lastPage; return applyFilters(tabId); }

  renderTable(tabId);
  renderPagination(tabId);

  const countEl = document.getElementById('resultCount-' + tabId);
  if (countEl) countEl.textContent = fmtNum(tab.total) + ' lead' + (tab.total > 1 ? 's' : '');
}

async function goPage(tabId, page) {
  const tab = STATE.tabs[tabId];
  const totalPages = Math.max(1, Math.ceil((tab.total || 0) / PAGE_SIZE));
  const target = Math.max(1, Math.min(page, totalPages));
  if (target === tab.page) return;
  tab.page = target;
  await applyFilters(tabId);
  const tw = document.querySelector('#tab-' + tabId + ' .table-wrap');
  if (tw) tw.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Conservée pour compatibilité : les valeurs de filtres viennent
// désormais de la base, pas d'un balayage du jeu de données.
function buildFilters() {}

function loadingHtml() {
  return `<div class="loading-wrap"><div class="spinner"></div><div class="loading-text">Chargement des leads…</div></div>`;
}

// ═══════════════════════════════════════════════
//  FILTER POPULATION
// ═══════════════════════════════════════════════
function initTab(tabId) {
  const tab = STATE.tabs[tabId];
  const container = document.getElementById('content-' + tabId);

  const icons = { chaud: '🔥', tiede: '⭐', froid: '❄️', client: '🔄', exclu: '🚫' };
  const names = { chaud: 'Chauds', tiede: 'Tièdes', froid: 'Froids', client: 'Clients', exclu: 'Exclus' };

  // Build the full lead tab HTML
  container.innerHTML = `
    <div class="lead-tab-header">
      <div class="tab-title">${icons[tabId]} ${names[tabId]}</div>
      <span class="result-count" id="resultCount-${tabId}">0 leads</span>
    </div>
    <div class="filters-bar">
      <div class="search-wrap">
        <span class="search-icon">🔍</span>
        <input type="text" class="search-input" id="search-${tabId}" placeholder="Rechercher société, ville, profession, commercial, SIREN…" autocomplete="off">
      </div>
      <select class="filter-select" id="dept-${tabId}">
        <option value="">Tous dépts</option>
        ${(tab._depts||[]).map(d => `<option value="${d}">${d}</option>`).join('')}
      </select>
      <select class="filter-select" id="prof-${tabId}">
        <option value="">Toutes professions</option>
        ${(tab._profs||[]).map(p => `<option value="${sanitize(p)}">${sanitize(p)}</option>`).join('')}
      </select>
      <select class="filter-select" id="comm-${tabId}">
        <option value="">Tous commerciaux</option>
        ${(tab._comms||[]).map(c => `<option value="${sanitize(c)}">${sanitize(c)}</option>`).join('')}
      </select>
      <select class="filter-select" id="statut-${tabId}">
        <option value="">Tous statuts</option>
        ${(tab._statuts||[]).map(s => `<option value="${sanitize(s)}">${sanitize(s)}</option>`).join('')}
      </select>
      <button class="reset-btn" data-act="reset" data-tab="${tabId}">✕ Réinitialiser</button>
    </div>
    <div class="table-wrap">
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th data-col="priorite" data-tab="${tabId}">Priorité <span class="sort-icon">⇅</span></th>
              <th data-col="societe" data-tab="${tabId}">Société <span class="sort-icon">⇅</span></th>
              <th data-col="profession" data-tab="${tabId}">Profession <span class="sort-icon">⇅</span></th>
              <th data-col="departement" data-tab="${tabId}">Dépt <span class="sort-icon">⇅</span></th>
              <th data-col="ville" data-tab="${tabId}">Ville <span class="sort-icon">⇅</span></th>
              <th>📞 Statut Tel.</th>
              <th>📅 Statut RDV</th>
              <th data-col="date_rdv" data-tab="${tabId}">Date RDV <span class="sort-icon">⇅</span></th>
              <th data-col="nb_rdvs" data-tab="${tabId}">RDVs <span class="sort-icon">⇅</span></th>
              <th data-col="commercial" data-tab="${tabId}">Commercial <span class="sort-icon">⇅</span></th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="tbody-${tabId}"></tbody>
        </table>
      </div>
      <div class="pagination" id="pagination-${tabId}"></div>
    </div>
  `;

  // Events
  const searchEl = document.getElementById('search-' + tabId);
  const deptEl = document.getElementById('dept-' + tabId);
  const profEl = document.getElementById('prof-' + tabId);
  const commEl = document.getElementById('comm-' + tabId);
  const statutEl = document.getElementById('statut-' + tabId);

  let searchTimer;
  searchEl.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { tab.search = searchEl.value; tab.page = 1; applyFilters(tabId); }, 180);
  });
  deptEl.addEventListener('change', () => { tab.dept = deptEl.value; tab.page = 1; applyFilters(tabId); });
  profEl.addEventListener('change', () => { tab.prof = profEl.value; tab.page = 1; applyFilters(tabId); });
  commEl.addEventListener('change', () => { tab.commercial = commEl.value; tab.page = 1; applyFilters(tabId); });
  statutEl.addEventListener('change', () => { tab.statut = statutEl.value; tab.page = 1; applyFilters(tabId); });

  // Sort
  container.querySelectorAll('th[data-col]').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (tab.sortCol === col) tab.sortDir *= -1;
      else { tab.sortCol = col; tab.sortDir = 1; }
      tab.page = 1;
      applyFilters(tabId);

      container.querySelectorAll('th[data-col]').forEach(h => h.classList.toggle('sorted', h.dataset.col === col));
      container.querySelectorAll('th[data-col] .sort-icon').forEach(ic => ic.textContent = '⇅');
      th.querySelector('.sort-icon').textContent = tab.sortDir === 1 ? '↑' : '↓';
    });
  });

  // Initial render
  applyFilters(tabId);
}

// ═══════════════════════════════════════════════
//  FILTER + SORT + RENDER
// ═══════════════════════════════════════════════
function renderTable(tabId) {
  const tab = STATE.tabs[tabId];
  const tbody = document.getElementById('tbody-' + tabId);
  if (!tbody) return;

  const slice = tab.sorted;

  if (slice.length === 0) {
    tbody.innerHTML = `<tr><td colspan="11"><div class="empty-state"><div class="empty-icon">🔍</div><div class="empty-text">Aucun lead trouvé</div><div class="empty-sub">Modifiez vos critères de recherche</div></div></td></tr>`;
    return;
  }

  tbody.innerHTML = slice.map(lead => {
    const noteIcon = Number(lead.note_count) > 0 ? '📝' : '📋';
    const issues = { issue_tel: lead.issue_tel || '', issue_rdv: lead.issue_rdv || '' };
    const telCell = issues.issue_tel
      ? `<span class="issue-pill ${issuePillClass(issues.issue_tel)}">${sanitize(issues.issue_tel)}</span>`
      : `<span style="color:var(--text-dim);font-size:12px">—</span>`;
    const rdvCell = issues.issue_rdv
      ? `<span class="issue-pill ${issuePillClass(issues.issue_rdv)}">${sanitize(issues.issue_rdv)}</span>`
      : `<span style="color:var(--text-dim);font-size:12px">—</span>`;
    return `<tr data-act="lead" data-id="${lead.id}">
      <td>${badgeHtml(lead.priorite)}</td>
      <td><div class="cell-societe" title="${sanitize(lead.societe)}">${sanitize(lead.societe) || '—'}</div></td>
      <td><div class="cell-profession" title="${sanitize(lead.profession)}">${sanitize(lead.profession) || '—'}</div></td>
      <td><span class="cell-dept">${lead.departement || '—'}</span></td>
      <td><div class="cell-ville" title="${sanitize(lead.ville)}">${sanitize(lead.ville) || '—'}</div></td>
      <td>${telCell}</td>
      <td>${rdvCell}</td>
      <td><span class="cell-date">${lead.date_rdv || '—'}</span></td>
      <td><span class="cell-rdvs">${lead.nb_rdvs ?? '—'}</span></td>
      <td><span class="cell-commercial">${sanitize(lead.commercial) || '—'}</span></td>
      <td data-stop="1">
        <div class="actions-cell">
          <a class="action-btn" href="tel:${lead.telephone || ''}" title="Appeler"${!lead.telephone ? ' style="pointer-events:none;opacity:0.4"' : ''}>📞</a>
          <button class="action-btn" data-act="lead" data-id="${lead.id}" title="Voir / Notes">${noteIcon}</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

// ═══════════════════════════════════════════════
//  PAGINATION
// ═══════════════════════════════════════════════
function renderPagination(tabId) {
  const tab = STATE.tabs[tabId];
  const total = tab.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const p = tab.page;
  const start = (p - 1) * PAGE_SIZE + 1;
  const end = Math.min(p * PAGE_SIZE, total);

  const pEl = document.getElementById('pagination-' + tabId);
  if (!pEl) return;

  if (total === 0) { pEl.innerHTML = ''; return; }

  // Build page buttons: first, prev, window, next, last
  const window_size = 5;
  let pages = [];
  let wStart = Math.max(1, p - Math.floor(window_size / 2));
  let wEnd = Math.min(totalPages, wStart + window_size - 1);
  if (wEnd - wStart + 1 < window_size) wStart = Math.max(1, wEnd - window_size + 1);

  for (let i = wStart; i <= wEnd; i++) pages.push(i);

  let btns = '';
  btns += `<button class="page-btn" data-act="page" data-tab="${tabId}" data-page="1" ${p===1?'disabled':''}>«</button>`;
  btns += `<button class="page-btn" data-act="page" data-tab="${tabId}" data-page="${p-1}" ${p===1?'disabled':''}>‹</button>`;
  if (wStart > 1) btns += `<button class="page-btn" data-act="page" data-tab="${tabId}" data-page="1">1</button>${wStart > 2 ? '<span style="color:var(--text-dim);padding:0 4px">…</span>' : ''}`;
  pages.forEach(pg => {
    btns += `<button class="page-btn ${pg===p?'active':''}" data-act="page" data-tab="${tabId}" data-page="${pg}">${pg}</button>`;
  });
  if (wEnd < totalPages) btns += `${wEnd < totalPages - 1 ? '<span style="color:var(--text-dim);padding:0 4px">…</span>' : ''}<button class="page-btn" data-act="page" data-tab="${tabId}" data-page="${totalPages}">${totalPages}</button>`;
  btns += `<button class="page-btn" data-act="page" data-tab="${tabId}" data-page="${p+1}" ${p===totalPages?'disabled':''}>›</button>`;
  btns += `<button class="page-btn" data-act="page" data-tab="${tabId}" data-page="${totalPages}" ${p===totalPages?'disabled':''}>»</button>`;

  pEl.innerHTML = `
    <span class="pagination-info">${fmtNum(start)}–${fmtNum(end)} sur ${fmtNum(total)}</span>
    <div class="pagination-btns">${btns}</div>
  `;
}

// ═══════════════════════════════════════════════
//  RESET FILTERS
// ═══════════════════════════════════════════════
function resetFilters(tabId) {
  const tab = STATE.tabs[tabId];
  tab.search = ''; tab.dept = ''; tab.prof = ''; tab.commercial = ''; tab.statut = '';
  tab.sortCol = ''; tab.sortDir = 1; tab.page = 1;

  const get = id => document.getElementById(id);
  const s = get('search-' + tabId); if (s) s.value = '';
  const d = get('dept-' + tabId); if (d) d.value = '';
  const p = get('prof-' + tabId); if (p) p.value = '';
  const c = get('comm-' + tabId); if (c) c.value = '';
  const st = get('statut-' + tabId); if (st) st.value = '';

  // Reset sort icons
  const container = document.getElementById('content-' + tabId);
  if (container) {
    container.querySelectorAll('th[data-col]').forEach(th => th.classList.remove('sorted'));
    container.querySelectorAll('th[data-col] .sort-icon').forEach(ic => ic.textContent = '⇅');
  }

  applyFilters(tabId);
}

// ═══════════════════════════════════════════════
//  ISSUE COLORS
// ═══════════════════════════════════════════════
function issuePillClass(val) {
  if (!val) return '';
  const map = {
    'Confirmé': 'ip-confirme', 'Annulé': 'ip-annule', 'Reporté': 'ip-reporte',
    'Injoignable': 'ip-injoignable', 'Répondeur': 'ip-repondeur',
    'À repositionner': 'ip-arepositionner', 'Hors cible': 'ip-horscible',
    'À rappeler': 'ip-arappeler', 'R2 confirmé': 'ip-r2confirme',
    'Signé': 'ip-signe', 'Refus': 'ip-refus', 'Réalisé': 'ip-realise',
    'R2 positionné': 'ip-r2positionne', 'R2 refus': 'ip-r2refus', 'Lapin': 'ip-lapin'
  };
  return map[val] || '';
}
function issuePillHtml(val, prefix) {
  if (!val) return '';
  const cls = issuePillClass(val);
  return `<span class="issue-pill ${cls}">${prefix ? prefix + ' ' : ''}${sanitize(val)}</span>`;
}

// ═══════════════════════════════════════════════
//  LEAD PAGE
// ═══════════════════════════════════════════════
let currentLeadId = null;

async function openLeadPage(id) {
  const lead = await fetchLead(id);
  if (!lead) return;
  currentLeadId = id;


  document.getElementById('lpCompany').textContent = lead.societe || '—';
  document.getElementById('lpBadge').innerHTML = badgeHtml(lead.priorite);

  const tel = lead.telephone || '';
  document.getElementById('lpTel').innerHTML = tel
    ? `<a href="tel:${tel}" style="color:var(--accent);text-decoration:none">${sanitize(tel)}</a>` : '—';
  document.getElementById('lpAdresse').textContent = lead.adresse || '—';

  const siren = lead.siren;
  if (siren) {
    document.getElementById('lpSiren').innerHTML =
      `<a class="siren-link" href="https://www.societe.com/cgi-bin/search?champs=${encodeURIComponent(siren)}" target="_blank" rel="noopener">` +
      `${sanitize(siren)} ↗</a>`;
  } else {
    document.getElementById('lpSiren').textContent = '—';
  }

  document.getElementById('lpProfession').textContent = lead.profession || '—';
  document.getElementById('lpDept').textContent = lead.departement || '—';
  document.getElementById('lpVille').textContent = lead.ville || '—';
  document.getElementById('lpLienArrowWrap').style.display = 'none';

  // Statuts seront mis à jour après chargement des issues (ci-dessous)
  document.getElementById('lpStatutTel').innerHTML = '—';
  document.getElementById('lpStatutRdv').innerHTML = '—';
  document.getElementById('lpDateRdv').textContent = lead.date_rdv || '—';
  document.getElementById('lpNbRdvs').textContent = lead.nb_rdvs ?? '—';
  document.getElementById('lpNbAudits').textContent = lead.nb_audits ?? '—';
  document.getElementById('lpPremPeriode').textContent = lead.premiere_periode || '—';
  document.getElementById('lpDernPeriode').textContent = lead.derniere_periode || '—';
  document.getElementById('lpCommercial').textContent = lead.commercial || '—';

  const origSection = document.getElementById('lpOriginalNotesSection');
  const origBox = document.getElementById('lpOriginalNotes');
  if (lead.notes && lead.notes.trim()) { origBox.textContent = lead.notes; origSection.style.display = ''; }
  else { origSection.style.display = 'none'; }

  const callBtn = document.getElementById('lpCallBtn');
  if (tel) { callBtn.href = 'tel:' + tel; callBtn.style.opacity = '1'; callBtn.style.pointerEvents = ''; }
  else { callBtn.href = '#'; callBtn.style.opacity = '0.4'; callBtn.style.pointerEvents = 'none'; }

  // Show page immediately, load async data after
  const page = document.getElementById('leadPage');
  page.classList.add('open');
  page.scrollTop = 0;
  document.body.style.overflow = 'hidden';

  // Reset issue selects while loading
  document.getElementById('lpIssueTel').value = '';
  document.getElementById('lpIssueRdv').value = '';

  // Load notes, issues, agenda in parallel
  const [, issues] = await Promise.all([
    renderLeadNotes(id, siren),
    dbLoadIssues(id, siren),
    renderLeadAgendaStatus(id, siren)
  ]);

  // Set issues dropdowns
  document.getElementById('lpIssueTel').value = issues.issue_tel || '';
  document.getElementById('lpIssueRdv').value = issues.issue_rdv || '';
  // Reflect as statut pills in suivi commercial
  const tel2 = issues.issue_tel || '';
  const rdv2 = issues.issue_rdv || '';
  document.getElementById('lpStatutTel').innerHTML = tel2
    ? `<span class="issue-pill ${issuePillClass(tel2)}">${sanitize(tel2)}</span>` : '—';
  document.getElementById('lpStatutRdv').innerHTML = rdv2
    ? `<span class="issue-pill ${issuePillClass(rdv2)}">${sanitize(rdv2)}</span>` : '—';
}

function closeLeadPage() {
  document.getElementById('leadPage').classList.remove('open');
  document.body.style.overflow = '';
  currentLeadId = null;
  if (STATE.currentTab && STATE.currentTab !== 'dashboard' && STATE.currentTab !== 'agenda') {
    renderTable(STATE.currentTab);
  }
}

// ESC key
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeLeadPage();
});

// ═══════════════════════════════════════════════
//  PERSONAL NOTES
// ═══════════════════════════════════════════════
async function renderLeadNotes(id, siren) {
  const listEl = document.getElementById('lpMyNotesList');
  const countEl = document.getElementById('lpNoteCount');
  if (!listEl) return;

  listEl.innerHTML = '<div class="lp-no-notes">Chargement…</div>';

  const notes = await dbLoadNotes(id, siren);

  if (countEl) {
    if (notes.length > 0) { countEl.textContent = notes.length; countEl.style.display = ''; }
    else { countEl.style.display = 'none'; }
  }

  if (notes.length === 0) {
    listEl.innerHTML = '<div class="lp-no-notes">Aucune note personnelle — ajoutez-en une ci-dessous.</div>';
    return;
  }

  const reversed = [...notes].reverse();
  listEl.innerHTML = reversed.map(note => {
    const d = new Date(note.date);
    const dateStr = d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const timeStr = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    return `<div class="lp-note-item">
      <div class="lp-note-meta">
        <span class="lp-note-date">📅 ${dateStr} à ${timeStr}</span>
        <button class="lp-note-delete" data-act="note-del" data-id="${note.id}" title="Supprimer">🗑</button>
      </div>
      <div class="lp-note-text">${sanitize(note.text)}</div>
    </div>`;
  }).join('');
}

async function saveLeadNote() {
  if (currentLeadId === null) return;
  const lead = LEAD_CACHE.get(currentLeadId) || null;
  if (!lead) return;

  const textarea = document.getElementById('lpNoteTextarea');
  const text = textarea.value.trim();
  if (!text) {
    textarea.style.borderColor = 'var(--red)';
    textarea.focus();
    setTimeout(() => { textarea.style.borderColor = ''; }, 1500);
    return;
  }

  const btn = document.getElementById('lpSaveNoteBtn');
  if (btn) { btn.innerHTML = '⏳'; btn.disabled = true; }

  await dbSaveNote(currentLeadId, text);
  textarea.value = '';
  await renderLeadNotes(currentLeadId, lead.siren);

  if (btn) {
    btn.disabled = false;
    btn.innerHTML = '✅ Enregistrée !';
    btn.style.background = 'var(--green, #10b981)';
    setTimeout(() => { btn.innerHTML = '💾 Enregistrer'; btn.style.background = ''; }, 2000);
  }
}

async function deleteLeadNote(noteId) {
  if (currentLeadId === null) return;
  const lead = LEAD_CACHE.get(currentLeadId) || null;
  if (!lead) return;
  await dbDeleteNote(noteId);
  await renderLeadNotes(currentLeadId, lead.siren);
}

// ═══════════════════════════════════════════════
//  ISSUES
// ═══════════════════════════════════════════════
async function saveIssues() {
  if (currentLeadId === null) return;
  const lead = LEAD_CACHE.get(currentLeadId) || null;
  if (!lead) return;
  const tel = document.getElementById('lpIssueTel').value;
  const rdv = document.getElementById('lpIssueRdv').value;
  await dbSaveIssues(currentLeadId, tel, rdv);
  // Refresh statut pills in "Suivi commercial"
  const statTelEl = document.getElementById('lpStatutTel');
  const statRdvEl = document.getElementById('lpStatutRdv');
  if (statTelEl) statTelEl.innerHTML = tel ? `<span class="issue-pill ${issuePillClass(tel)}">${sanitize(tel)}</span>` : '—';
  if (statRdvEl) statRdvEl.innerHTML = rdv ? `<span class="issue-pill ${issuePillClass(rdv)}">${sanitize(rdv)}</span>` : '—';
  // Refresh table row
  if (STATE.currentTab && STATE.currentTab !== 'dashboard' && STATE.currentTab !== 'agenda') {
    renderTable(STATE.currentTab);
  }
}

// ═══════════════════════════════════════════════
//  AGENDA
// ═══════════════════════════════════════════════
async function renderLeadAgendaStatus(leadId, siren) {
  const statusEl = document.getElementById('lpAgendaStatus');
  if (!statusEl) return;
  const agenda = await dbLoadAgenda();
  const entries = agenda.filter(e => String(e.lead_id) === String(leadId) && !e.disabled);
  if (entries.length === 0) { statusEl.innerHTML = ''; return; }

  statusEl.innerHTML = entries.map(e => {
    const d = new Date(e.date_rdv + 'T12:00:00');
    const dateStr = d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
    return `<div class="agenda-status-card">
      <div class="agenda-status-info">
        📅 RDV planifié : <span class="agenda-status-date">${dateStr}${e.heure_rdv ? ' à ' + e.heure_rdv : ''}</span>
        ${e.note_rdv ? ' — ' + sanitize(e.note_rdv) : ''}
      </div>
      <button class="agenda-remove-btn" data-act="agenda-del" data-id="${e.id}">✕ Retirer de l'agenda</button>
    </div>`;
  }).join('');
}

async function addToAgenda() {
  if (currentLeadId === null) return;
  const lead = LEAD_CACHE.get(currentLeadId) || null;
  if (!lead) return;

  const date = document.getElementById('lpPlanDate').value;
  const heure = document.getElementById('lpPlanHeure').value;
  const note = document.getElementById('lpPlanNote').value.trim();

  if (!date) {
    const inp = document.getElementById('lpPlanDate');
    inp.style.borderColor = 'var(--red)';
    setTimeout(() => { inp.style.borderColor = ''; }, 1500);
    return;
  }

  const btn = document.getElementById('lpAddAgendaBtn');
  if (btn) { btn.innerHTML = '⏳ Ajout en cours…'; btn.disabled = true; }

  await dbAddAgenda(lead, date, heure, note);
  document.getElementById('lpPlanDate').value = '';
  document.getElementById('lpPlanHeure').value = '';
  document.getElementById('lpPlanNote').value = '';

  await renderLeadAgendaStatus(currentLeadId, lead.siren);

  // Refresh agenda badge
  updateAgendaBadge();

  if (btn) {
    btn.disabled = false;
    btn.innerHTML = '✅ Ajouté !';
    btn.style.background = 'var(--green, #10b981)';
    setTimeout(() => { btn.innerHTML = '➕ Ajouter à l\'agenda'; btn.style.background = ''; }, 2000);
  }
}

async function removeFromAgenda(entryId) {
  if (currentLeadId === null) return;
  const lead = LEAD_CACHE.get(currentLeadId) || null;
  await dbRemoveAgenda(entryId);
  await renderLeadAgendaStatus(currentLeadId, lead ? lead.siren : null);
  updateAgendaBadge();
}

async function disableAgenda(entryId) {
  await dbDisableAgenda(entryId);
  await renderAgendaTab();
}

async function enableAgenda(entryId) {
  await dbEnableAgenda(entryId);
  await renderAgendaTab();
}

async function updateAgendaBadge() {
  const agenda = lsGet('arrow_agenda') || [];
  const active = agenda.filter(e => !e.disabled).length;
  const badge = document.getElementById('badge-agenda');
  if (badge) badge.textContent = active > 0 ? active : '';
}

async function renderAgendaTab() {
  const container = document.getElementById('content-agenda');
  if (!container) return;
  container.innerHTML = '<div class="loading-wrap"><div class="spinner"></div><div class="loading-text">Chargement…</div></div>';

  const entries = await dbLoadAgenda();
  const active = entries.filter(e => !e.disabled).sort((a, b) => {
    const da = new Date(a.date_rdv + 'T' + (a.heure_rdv || '00:00'));
    const db = new Date(b.date_rdv + 'T' + (b.heure_rdv || '00:00'));
    return da - db;
  });
  const done = entries.filter(e => e.disabled).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  const badge = document.getElementById('badge-agenda');
  if (badge) badge.textContent = active.length > 0 ? active.length : '';

  if (active.length === 0 && done.length === 0) {
    container.innerHTML = `<div class="empty-state">
      <div class="empty-icon">📅</div>
      <div class="empty-text">Aucun RDV planifié</div>
      <div class="empty-sub">Ouvrez un lead et cliquez "Ajouter à l'agenda"</div>
    </div>`;
    return;
  }

  let html = '';
  if (active.length > 0) {
    html += '<div class="agenda-section-title">À venir</div>';
    html += '<div class="agenda-grid">' + active.map(e => agendaCardHtml(e)).join('') + '</div>';
  }
  if (done.length > 0) {
    html += '<div class="agenda-section-title agenda-section-done">✓ Réalisés / Désactivés</div>';
    html += '<div class="agenda-grid">' + done.map(e => agendaCardHtml(e)).join('') + '</div>';
  }
  container.innerHTML = html;
}

function agendaCardHtml(entry) {
  const date = new Date(entry.date_rdv + 'T12:00:00');
  const today = new Date(); today.setHours(0,0,0,0);
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
  const entryDay = new Date(date); entryDay.setHours(0,0,0,0);

  let color = '#4f8ef7';
  let label = '';
  if (entryDay.getTime() === today.getTime())    { color = '#f97316'; label = "Aujourd'hui"; }
  else if (entryDay.getTime() === tomorrow.getTime()) { color = '#eab308'; label = 'Demain'; }
  else if (entryDay < today)                      { color = '#ef4444'; label = 'Passé'; }

  const dayStr = date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
  const disabled = entry.disabled;

  return `<div class="agenda-card ${disabled ? 'agenda-card-done' : ''}" style="border-left-color:${color}">
    <div class="agenda-card-header">
      <div class="agenda-date-col">
        <span class="agenda-date-text" style="color:${color}">${dayStr}</span>
        ${label ? `<span class="agenda-date-label" style="color:${color}">${label}</span>` : ''}
        ${entry.heure_rdv ? `<span class="agenda-heure">${entry.heure_rdv}</span>` : ''}
      </div>
      <div class="agenda-info">
        <div class="agenda-company" data-act="lead" data-id="${entry.lead_id}">${sanitize(entry.societe)}</div>
        <div class="agenda-meta">
          ${badgeHtml(entry.priorite)}
          <span style="color:var(--text-muted);font-size:12px">Dépt ${entry.departement} • ${sanitize(entry.ville)} • ${sanitize(entry.commercial)}</span>
        </div>
        ${entry.note_rdv ? `<div class="agenda-note">📝 ${sanitize(entry.note_rdv)}</div>` : ''}
      </div>
      <div class="agenda-card-actions">
        <a class="action-btn" href="tel:${entry.telephone || ''}" title="Appeler"${!entry.telephone ? ' style="opacity:0.4;pointer-events:none"' : ''}>📞</a>
        ${!disabled
          ? `<button class="agenda-disable-btn" data-act="agenda-off" data-id="${entry.id}">✓ Réalisé</button>`
          : `<button class="agenda-enable-btn" data-act="agenda-on" data-id="${entry.id}">↩ Réactiver</button>`}
      </div>
    </div>
  </div>`;
}

// ═══════════════════════════════════════════════
//  TABLEAU DE BORD — agrégats calculés en base
// ═══════════════════════════════════════════════
let _chartReady = false;
function ensureChartDefaults() {
  if (_chartReady) return true;
  if (typeof Chart === 'undefined') return false;
  Chart.defaults.color = '#7b82a0';
  Chart.defaults.font.family = "'Sora', sans-serif";
  Chart.defaults.font.size = 12;
  _chartReady = true;
  return true;
}

const PRIORITY_COLORS = {
  '🔥 Chaud':  '#ff6b35',
  '⭐ Tiède':  '#f59e0b',
  '❄️ Froid':  '#60a5fa',
  '🔄 Client': '#10b981',
  '🚫 Exclu':  '#6b7280'
};

let _charts = {};

function drawChart(canvasId, config) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  if (!ensureChartDefaults()) {
    // Les chiffres restent lisibles dans les tableaux voisins ;
    // seul le visuel manque, et on le dit plutôt que de laisser un
    // cadre vide inexpliqué.
    const wrap = canvas.parentElement;
    if (wrap) wrap.innerHTML = '<div class="empty-state">'
      + '<div class="empty-text">Graphique indisponible</div>'
      + '<div class="empty-sub">Les chiffres restent consultables ci-dessous.</div></div>';
    return;
  }
  if (_charts[canvasId]) _charts[canvasId].destroy();
  _charts[canvasId] = new Chart(canvas.getContext('2d'), config);
}

// Les deux tableaux de détail partagent la même forme : libellé,
// volume, part de leads chauds, et une barre relative au plus gros
// de la liste.
function renderStatTable(bodyId, rows, labelKey, accentVar) {
  const tbody = document.getElementById(bodyId);
  if (!tbody) return;

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="4" style="color:var(--text-dim)">Aucune donnée</td></tr>';
    return;
  }

  const max = Math.max.apply(null, rows.map(r => Number(r.n))) || 1;

  tbody.innerHTML = rows.map(r => {
    const n = Number(r.n);
    const hot = Number(r.n_chaud || 0);
    const hotPct = n ? Math.round((hot / n) * 100) : 0;
    const width = Math.max(2, Math.round((n / max) * 100));
    return '<tr>'
      + `<td style="font-weight:500">${sanitize(String(r[labelKey]))}</td>`
      + `<td style="font-variant-numeric:tabular-nums">${fmtNum(n)}</td>`
      + `<td style="color:var(${accentVar});font-weight:600;font-variant-numeric:tabular-nums">${hotPct} %</td>`
      + `<td><div class="bar-mini" style="width:${width}%${accentVar === '--warm' ? ';background:var(--warm)' : ''}"></div></td>`
      + '</tr>';
  }).join('');
}

async function renderDashboard() {
  const data = await fetchDashboard();
  if (!data) return;

  const total = Number(data.totals.total_leads) || 0;

  // Total affiché en tête du tableau de bord.
  const totalEl = document.querySelector('.kpi-total span:last-child');
  if (totalEl) totalEl.textContent = fmtNum(total);

  // Tuiles par température. Les classes portées par les cartes
  // (hot, warm, cold, client, exclu) servent de clé de rapprochement.
  const KPI_CLASS = {
    '🔥 Chaud': 'hot', '⭐ Tiède': 'warm', '❄️ Froid': 'cold',
    '🔄 Client': 'client', '🚫 Exclu': 'exclu'
  };
  data.priorite.forEach(row => {
    const cls = KPI_CLASS[row.priorite];
    if (!cls) return;
    const card = document.querySelector('.kpi-card.' + cls);
    if (!card) return;
    const n = Number(row.n);
    const valueEl = card.querySelector('.kpi-value');
    const pctEl   = card.querySelector('.kpi-pct');
    if (valueEl) valueEl.textContent = fmtNum(n);
    if (pctEl) {
      const pct = total ? (n / total * 100).toFixed(1).replace('.', ',') : '0,0';
      pctEl.textContent = pct + ' % du total';
    }
  });

  drawChart('donutChart', {
    type: 'doughnut',
    data: {
      labels: data.priorite.map(r => r.priorite),
      datasets: [{
        data: data.priorite.map(r => Number(r.n)),
        backgroundColor: data.priorite.map(r => PRIORITY_COLORS[r.priorite] || '#6b7280'),
        borderColor: '#141720',
        borderWidth: 3,
        hoverOffset: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '62%',
      plugins: {
        legend: { position: 'bottom', labels: { padding: 14, usePointStyle: true } },
        tooltip: {
          callbacks: {
            label: c => `${c.label} : ${fmtNum(c.parsed)} (${total ? ((c.parsed / total) * 100).toFixed(1) : 0} %)`
          }
        }
      }
    }
  });

  const barOptions = {
    responsive: true,
    maintainAspectRatio: false,
    indexAxis: 'y',
    plugins: { legend: { display: false } },
    scales: {
      x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { precision: 0 } },
      y: { grid: { display: false } }
    }
  };

  drawChart('deptChart', {
    type: 'bar',
    data: {
      labels: data.departement.map(r => 'Dépt ' + r.departement),
      datasets: [{ data: data.departement.map(r => Number(r.n)), backgroundColor: '#60a5fa', borderRadius: 4 }]
    },
    options: barOptions
  });

  drawChart('profChart', {
    type: 'bar',
    data: {
      labels: data.profession.map(r => r.profession),
      datasets: [{ data: data.profession.map(r => Number(r.n)), backgroundColor: '#ff6b35', borderRadius: 4 }]
    },
    options: barOptions
  });

  renderStatTable('deptTableBody', data.departement.slice(0, 10), 'departement', '--hot');
  renderStatTable('profTableBody', data.profession.slice(0, 10), 'profession', '--warm');
}

// Responsive: collapse detail tables on small screens
(function() {
  const grid = document.querySelector('.detail-tables-grid');
  if (!grid) return;
  function checkWidth() {
    grid.style.gridTemplateColumns = window.innerWidth < 800 ? '1fr' : '1fr 1fr';
  }
  checkWidth();
  window.addEventListener('resize', checkWidth);
})();
// ═══════════════════════════════════════════════
//  ÉVÉNEMENTS
//
//  Un écouteur unique plutôt que des attributs onclick dans le
//  markup : la page peut alors être servie sous une CSP sans
//  'unsafe-inline', ce qui referme la porte au XSS.
// ═══════════════════════════════════════════════
const ACTIONS = {
  'tab':        el => switchTab(el.dataset.tab),
  'page':       el => goPage(el.dataset.tab, Number(el.dataset.page)),
  'reset':      el => resetFilters(el.dataset.tab),
  'lead':       el => openLeadPage(Number(el.dataset.id)),
  'lead-close': ()  => closeLeadPage(),
  'note-save':  ()  => saveLeadNote(),
  'note-del':   el => deleteLeadNote(el.dataset.id),
  'agenda-add': ()  => addToAgenda(),
  'agenda-del': el => removeFromAgenda(el.dataset.id),
  'agenda-off': el => disableAgenda(el.dataset.id),
  'agenda-on':  el => enableAgenda(el.dataset.id),
  'signout':    ()  => signOut(),
  'relogin':    ()  => showGate('login')
};

document.addEventListener('click', event => {
  const el = event.target.closest('[data-act], [data-stop]');
  if (!el) return;
  const action = el.dataset.act;
  if (!action) return;           // barrière data-stop : on ne remonte pas
  const handler = ACTIONS[action];
  if (handler) handler(el);
});

document.addEventListener('submit', event => {
  if (event.target.id === 'authLogin') handleLoginSubmit(event);
});

// ═══════════════════════════════════════════════
//  DÉMARRAGE ET SESSION
// ═══════════════════════════════════════════════
function showGate(view) {
  const gate = document.getElementById('authGate');
  const app  = document.getElementById('appRoot');
  if (!gate || !app) return;
  gate.style.display = view === 'app' ? 'none' : 'flex';
  app.style.display  = view === 'app' ? '' : 'none';
  ['authLoading', 'authLogin', 'authSent', 'authFatal'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = (id === 'auth' + view.charAt(0).toUpperCase() + view.slice(1)) ? '' : 'none';
  });
}

function showFatal(message) {
  const el = document.getElementById('authFatalText');
  if (el) el.textContent = message;
  showGate('fatal');
}

async function handleLoginSubmit(event) {
  event.preventDefault();
  const input = document.getElementById('authEmail');
  const btn   = document.getElementById('authSubmit');
  const err   = document.getElementById('authError');
  const email = (input.value || '').trim().toLowerCase();

  err.textContent = '';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    err.textContent = 'Saisissez une adresse email valide.';
    input.focus();
    return;
  }

  btn.disabled = true;
  const previous = btn.textContent;
  btn.textContent = 'Envoi…';

  const result = await sendMagicLink(email);

  btn.disabled = false;
  btn.textContent = previous;

  if (!result.ok) { err.textContent = result.message; return; }
  const sentTo = document.getElementById('authSentTo');
  if (sentTo) sentTo.textContent = email;
  showGate('sent');
}

async function enterApp() {
  ME = await loadProfile();
  if (!ME) {
    showFatal("Votre compte existe mais n'est pas activé dans l'application. Contactez votre directeur d'agence.");
    return;
  }
  if (!ME.active) {
    showFatal('Votre accès a été désactivé.');
    return;
  }

  const who = document.getElementById('sessionUser');
  if (who) who.textContent = ME.nom || ME.email;

  showGate('app');

  await loadPriorityBadges();
  await renderDashboard();
  switchTab(STATE.currentTab || 'dashboard');
}

async function loadPriorityBadges() {
  const { data, error } = await sb().from('v_stats_priorite').select('*');
  if (error) { failed('Chargement des compteurs', error); return; }
  const byTab = { '🔥 Chaud': 'chaud', '⭐ Tiède': 'tiede', '❄️ Froid': 'froid',
                  '🔄 Client': 'client', '🚫 Exclu': 'exclu' };
  data.forEach(row => {
    const tabId = byTab[row.priorite];
    if (!tabId) return;
    const badge = document.getElementById('badge-' + tabId);
    if (badge) badge.textContent = fmtNum(Number(row.n));
  });
}

async function boot() {
  showGate('loading');

  if (!isConfigured()) {
    showFatal("L'application n'est pas configurée : config.js est absent ou incomplet. "
      + 'Voir docs/DEPLOIEMENT.md.');
    return;
  }

  const client = sb();
  if (!client) { showFatal('Impossible d’initialiser la connexion à la base.'); return; }

  // Un lien magique ramène l'utilisateur avec un jeton dans l'URL ;
  // le client le consomme, puis on nettoie la barre d'adresse pour ne
  // pas laisser traîner un jeton dans l'historique du navigateur.
  client.auth.onAuthStateChange((event, session) => {
    SESSION = session;
    if (event === 'SIGNED_IN') {
      if (window.location.hash.includes('access_token')) {
        history.replaceState(null, '', window.location.pathname + window.location.search);
      }
      enterApp();
    }
    if (event === 'SIGNED_OUT') showGate('login');
  });

  const { data, error } = await client.auth.getSession();
  if (error) { showFatal('Session illisible : ' + error.message); return; }

  SESSION = data.session;
  if (SESSION) await enterApp();
  else showGate('login');
}

document.addEventListener('DOMContentLoaded', boot);
