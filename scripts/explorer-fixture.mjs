// Synthetic records only. No production account or customer data is used by browser tests.
export async function mockApi(context) {
  const user = { id: '22222222-2222-2222-2222-222222222222', email: 'test@example.invalid', role: 'authenticated' };
  const payload = Buffer.from(JSON.stringify({ exp: 4102444800, sub: user.id, role: 'authenticated' })).toString('base64url');
  const session = { access_token: 'eyJhbGciOiJIUzI1NiJ9.' + payload + '.test', refresh_token: 'test', expires_at: 4102444800, expires_in: 3600, token_type: 'bearer', user };
  await context.addInitScript(session => localStorage.setItem('sb-local-test-auth-token', JSON.stringify(session)), session);
  const notes = [];
  const issues = {};
  const agenda = [];
  const companies = ['Atelier du Cèdre', 'Maison Solis', 'Les Jardins de Nacre', 'Studio Mistral', 'Azur Énergies', 'La Fabrique des Toits'];
  const leads = Array.from({ length: 65 }, (_, index) => ({
    id: index + 1, siren: String(100000000 + index), societe: companies[index % companies.length] + (index > 5 ? ' ' + index : ''),
    ville: ['Avignon', 'Orange', 'Nîmes', 'Arles', 'Montélimar', 'Montpellier'][index % 6],
    departement: index < 60 ? [84,84,30,13,26,34][index % 6] : [20,974,69,6,4][index - 60],
    telephone: '0100000000', priorite: index % 2 ? '⭐ Tiède' : '🔥 Chaud',
    profession: ['Menuiserie','Rénovation','Paysagiste'][index % 3], commercial: 'Commercial test',
    notes: 'Historique fictif de démonstration.', adresse: 'Adresse fictive', nb_rdvs: 2
  }));
  const requests = [];
  const state = { failNotes: false, failSearch: false, notes, issues, agenda, requests };
  await context.route('https://local-test.supabase.co/**', async route => {
    const req = route.request(); const url = new URL(req.url());
    const path = url.pathname; const body = req.postDataJSON();
    let data = null; let status = 200;
    const equalId = key => Number((url.searchParams.get(key) || '').replace('eq.', ''));
    if (path.includes('/auth/')) data = { user };
    else if (path.endsWith('/app_users')) data = { ...user, nom: 'Compte de test', active: true, role: 'directeur' };
    else if (path.endsWith('/rpc/lead_filter_options_v2')) data = { departement: ['4','6','13','20','26','30','34','69','84','974'], profession: ['Menuiserie','Rénovation','Paysagiste'], commercial: ['Commercial test'], statut: ['Confirmé'] };
    else if (path.endsWith('/rpc/search_leads_v2')) {
      requests.push(body);
      if (state.failSearch) { status = 503; data = { message: 'synthetic failure' }; }
      else {
        const rows = leads.filter(lead => (!body.p_departments || body.p_departments.includes(lead.departement))
          && (!body.p_departement || body.p_departement === lead.departement)
          && (!body.p_priorite || body.p_priorite === lead.priorite)
          && (!body.p_search || lead.societe.toLowerCase().includes(body.p_search.toLowerCase()))
          && (!body.p_issue_tel || (issues[lead.id]?.issue_tel || '') === (body.p_issue_tel === '__empty' ? '' : body.p_issue_tel))
          && (!body.p_issue_rdv || (issues[lead.id]?.issue_rdv || '') === (body.p_issue_rdv === '__empty' ? '' : body.p_issue_rdv)));
        data = { total: rows.length, rows: rows.slice(body.p_offset, body.p_offset + body.p_limit).map(lead => ({ ...lead, ...issues[lead.id], note_count: notes.filter(note => note.lead_id === lead.id).length })) };
      }
    } else if (path.endsWith('/leads')) data = leads.find(lead => lead.id === equalId('id'));
    else if (path.endsWith('/lead_issues')) {
      if (req.method() === 'POST') { issues[body.lead_id] = body; data = null; }
      else data = issues[equalId('lead_id')] || null;
    } else if (path.endsWith('/lead_notes')) {
      if (req.method() === 'POST') {
        if (state.failNotes) { status = 503; data = { message: 'synthetic failure' }; }
        else { notes.push({ ...body, created_at: new Date().toISOString(), app_users: { nom: 'Compte de test' } }); data = { id: body.id }; }
      } else data = notes.filter(note => note.lead_id === equalId('lead_id')).toReversed();
    } else if (path.endsWith('/agenda')) {
      if (req.method() === 'POST') { agenda.push({ ...body, disabled: false }); data = { id: body.id }; }
      else if (req.method() === 'PATCH') {
        const id = url.searchParams.get('id').replace('eq.', '');
        Object.assign(agenda.find(entry => entry.id === id), body); data = { id };
      } else data = url.searchParams.has('lead_id') ? agenda.filter(entry => entry.lead_id === equalId('lead_id')) : agenda;
    } else { status = 404; data = { message: 'Unknown fixture route' }; }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
  });
  return state;
}
