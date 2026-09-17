import { client, request, setIdentity } from './modules/data.js';
import { icon, errorState, toast } from './modules/ui.js';
import { renderLeads } from './modules/leads.js';
import { renderDetail } from './modules/detail.js';
import { renderAgenda } from './modules/agenda.js';

const workspace = document.getElementById('workspace');
let authenticated = false;
let routeVersion = 0;
let cleanup = () => {};
let entering = null;
let activeUser = null;
let renderedUrl = location.href;

function gate(view, message = '') {
  document.getElementById('authGate').hidden = view === 'app';
  document.getElementById('appRoot').hidden = view !== 'app';
  for (const name of ['Loading', 'Login', 'Fatal']) {
    document.getElementById('auth' + name).hidden = view !== name.toLowerCase();
  }
  document.getElementById('authFatalText').textContent = message;
}

async function route() {
  if (!authenticated) return;
  cleanup();
  renderedUrl = location.href;
  const version = ++routeVersion;
  const current = () => version === routeVersion && authenticated;
  const params = new URLSearchParams(location.search);
  const leadId = params.get('lead');
  const view = params.get('view') === 'agenda' ? 'agenda' : 'leads';
  document.querySelectorAll('[data-view]').forEach(link => {
    if (link.dataset.view === view) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  try {
    let dispose;
    if (leadId) dispose = await renderDetail(workspace, leadId, navigate, current);
    else if (view === 'agenda') dispose = await renderAgenda(workspace, navigate, current);
    else dispose = await renderLeads(workspace, navigate, current);
    if (current()) cleanup = dispose; else dispose();
  } catch {
    if (current()) workspace.replaceChildren(errorState('Le chargement a échoué.', route));
  }
}

function navigate(params) {
  if (document.querySelector('[data-dirty="true"]') && !confirm('Quitter sans enregistrer votre saisie ?')) return;
  history.pushState(null, '', '?' + params.toString());
  route();
  workspace.focus();
  window.scrollTo(0, 0);
}

async function enter(session) {
  if (!session) return;
  if (authenticated && activeUser === session.user.id) return;
  if (entering) return entering;
  entering = (async () => {
    try {
      const profile = await request(client().from('app_users').select('id,nom,email,role,active').eq('id', session.user.id).single());
      if (!profile?.active) {
        gate('fatal', 'Votre accès est désactivé ou votre profil est indisponible. Contactez votre direction.');
        return;
      }
      activeUser = session.user.id;
      setIdentity(profile);
      authenticated = true;
      document.getElementById('sessionUser').textContent = profile.nom || profile.email;
      gate('app');
      await route();
    } catch {
      gate('fatal', 'Impossible de vérifier votre accès. Vérifiez votre connexion et réessayez.');
    } finally { entering = null; }
  })();
  return entering;
}

async function signOut() {
  try {
    await request(client().auth.signOut());
    authenticated = false;
    activeUser = null;
    setIdentity(null);
    cleanup();
    workspace.replaceChildren();
    gate('login');
  } catch { toast('Déconnexion impossible. Vérifiez votre connexion et réessayez.', true); }
}

document.getElementById('authLogin').addEventListener('submit', async event => {
  event.preventDefault();
  const email = document.getElementById('authEmail');
  const password = document.getElementById('authPassword');
  const error = document.getElementById('authError');
  const button = document.getElementById('authSubmit');
  if (button.disabled) return;
  error.textContent = '';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.value.trim())) {
    error.textContent = 'Saisissez une adresse email valide.'; email.focus(); return;
  }
  if (!password.value) { error.textContent = 'Saisissez votre mot de passe.'; password.focus(); return; }
  button.disabled = true;
  button.textContent = 'Connexion…';
  try {
    const result = await request(client().auth.signInWithPassword({ email: email.value.trim(), password: password.value }));
    password.value = '';
    await enter(result.session);
  } catch (cause) {
    error.textContent = cause.code === 'invalid_credentials'
      ? 'Adresse ou mot de passe incorrect.' : 'Connexion impossible. Vérifiez vos identifiants et votre réseau, puis réessayez.';
    password.focus();
  } finally { button.disabled = false; button.textContent = 'Se connecter'; }
});

document.querySelectorAll('[data-view]').forEach(link => {
  link.prepend(icon(link.dataset.view === 'agenda' ? 'calendar' : 'users'));
  link.addEventListener('click', event => {
    event.preventDefault();
    const params = new URLSearchParams(location.search);
    params.delete('lead');
    if (link.dataset.view === 'agenda') params.set('view', 'agenda'); else params.delete('view');
    navigate(params);
  });
});
document.getElementById('signOut').addEventListener('click', signOut);
document.getElementById('authLogout').addEventListener('click', signOut);
document.getElementById('authRetry').addEventListener('click', () => location.reload());
window.addEventListener('popstate', () => {
  if (document.querySelector('[data-dirty="true"]') && !confirm('Quitter sans enregistrer votre saisie ?')) {
    history.pushState(null, '', renderedUrl); return;
  }
  route();
});
window.addEventListener('beforeunload', event => {
  if (document.querySelector('[data-dirty="true"]')) { event.preventDefault(); event.returnValue = ''; }
});
function networkState() { document.getElementById('offline').hidden = navigator.onLine; }
window.addEventListener('online', networkState);
window.addEventListener('offline', networkState);
networkState();

async function boot() {
  gate('loading');
  try {
    const sb = client();
    // Leave the auth callback before querying PostgREST to avoid the SDK's session lock.
    sb.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN') setTimeout(() => enter(session), 0);
      if (event === 'SIGNED_OUT') {
        authenticated = false; activeUser = null; setIdentity(null);
        routeVersion++; cleanup(); workspace.replaceChildren(); gate('login');
      }
    });
    const data = await request(sb.auth.getSession());
    if (data.session) await enter(data.session); else gate('login');
  } catch { gate('fatal', 'Connexion au service indisponible. Réessayez ou contactez votre direction.'); }
}
boot();
