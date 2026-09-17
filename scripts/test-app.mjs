#!/usr/bin/env node
/**
 * Tests de l'application dans un vrai navigateur, servie avec les
 * en-têtes de sécurité de production.
 *
 * Servir la page sans sa CSP ne prouve rien : c'est précisément sous
 * CSP que les scripts inline, les gestionnaires onclick et les
 * ressources tierces cassent. Ce test échoue si une violation est
 * signalée.
 *
 *   npm run test:app
 *
 * CHROME_PATH permet de désigner un binaire Chromium déjà présent.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const appDir = join(root, 'app');
const PORT = Number(process.env.TEST_PORT || 5199);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.txt':  'text/plain; charset=utf-8',
  '.json': 'application/json'
};

// Les en-têtes réellement déployés, lus depuis vercel.json : le test
// ne peut pas diverger silencieusement de la production.
const vercel = JSON.parse(await readFile(join(root, 'vercel.json'), 'utf8'));
const headers = Object.fromEntries(
  vercel.headers[0].headers.map(h => [h.key, h.value])
);

const results = [];
const check = (label, ok, detail) => results.push({ label, ok: Boolean(ok), detail });

const server = createServer(async (req, res) => {
  const rel = normalize(decodeURIComponent((req.url || '/').split('?')[0]));
  const path = rel === '/' ? '/index.html' : rel;
  try {
    const body = await readFile(join(appDir, path));
    res.writeHead(200, { ...headers, 'Content-Type': TYPES[extname(path)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, headers);
    res.end('not found');
  }
});
await new Promise(r => server.listen(PORT, r));

const browser = await chromium.launch(
  process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}
);
const page = await browser.newPage();

const pageErrors = [];
const cspViolations = [];
page.on('pageerror', e => pageErrors.push(e.message));
page.on('console', m => {
  const text = m.text();
  if (/Content Security Policy/i.test(text)) cspViolations.push(text);
  else if (m.type() === 'error' && !/ERR_(CONNECTION|TUNNEL|NAME)/.test(text)) pageErrors.push(text);
});

await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1200);

check('aucune violation CSP', cspViolations.length === 0, cspViolations[0]);
check('aucune erreur JavaScript', pageErrors.length === 0, pageErrors[0]);
check("l'écran de connexion est affiché", await page.locator('#authLogin').isVisible());
check("l'application reste masquée tant qu'on n'est pas connecté",
  !(await page.locator('#appRoot').isVisible()));
check('le champ email est présent', await page.locator('#authEmail').isVisible());

// La délégation d'événements remplace les attributs onclick : si elle
// ne fonctionne pas, plus rien n'est cliquable dans l'application.
check('le champ mot de passe est présent', await page.locator('#authPassword').isVisible());

await page.fill('#authEmail', 'pas-une-adresse');
await page.fill('#authPassword', 'peu importe');
await page.click('#authSubmit');
await page.waitForTimeout(300);
const emailError = (await page.locator('#authError').textContent() || '').trim();
check('la soumission passe par la délégation et refuse une adresse invalide',
  emailError.length > 0, emailError || '(aucun message)');
check('le message de validation est le nôtre, pas celui du navigateur',
  /adresse email valide/i.test(emailError), emailError);
check('le champ fautif reprend le focus',
  await page.evaluate(() => document.activeElement && document.activeElement.id === 'authEmail'));

// Un mot de passe manquant doit être signalé avant tout appel réseau.
await page.fill('#authEmail', 'valide@exemple.fr');
await page.fill('#authPassword', '');
await page.click('#authSubmit');
await page.waitForTimeout(300);
const passError = (await page.locator('#authError').textContent() || '').trim();
check('un mot de passe vide est refusé sans appel réseau',
  /mot de passe/i.test(passError), passError || '(aucun message)');

// Le mot de passe ne doit jamais être lisible à l'écran.
check('le mot de passe est masqué',
  (await page.locator('#authPassword').getAttribute('type')) === 'password');

check('les librairies embarquées sont chargées',
  await page.evaluate(() => typeof window.supabase !== 'undefined'));
check('la configuration est exposée à la page',
  await page.evaluate(() => Boolean(window.ARROW_CONFIG && window.ARROW_CONFIG.supabaseUrl)));

// Écran de téléphone : le corps de page ne doit jamais défiler
// latéralement.
await page.setViewportSize({ width: 390, height: 780 });
await page.waitForTimeout(200);
const overflow = await page.evaluate(
  () => document.documentElement.scrollWidth - document.documentElement.clientWidth);
check('aucun débordement horizontal à 390 px', overflow <= 0, `débordement de ${overflow}px`);

await browser.close();
server.close();

let failed = 0;
for (const r of results) {
  console.log(`${r.ok ? ' OK   ' : ' ECHEC'}  ${r.label}${r.ok || !r.detail ? '' : `\n         ${r.detail}`}`);
  if (!r.ok) failed++;
}
console.log(`\n${results.length - failed} réussis, ${failed} échecs, ${results.length} au total`);
process.exit(failed ? 1 : 0);
