let sdk;
let identity;
export const setIdentity = profile => { identity = profile; };
export const me = () => identity;

export function client() {
  if (sdk) return sdk;
  const config = window.ARROW_CONFIG;
  if (!config?.supabaseUrl || !config?.supabaseAnonKey || !window.supabase) throw new Error('configuration');
  sdk = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    global: { fetch: (url, options = {}) => fetch(url, { ...options, signal: options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000) }) }
  });
  return sdk;
}

export async function request(query) {
  let timer;
  try {
    const result = await Promise.race([query, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), 14000);
    })]);
    if (result.error) throw result.error;
    return result.data;
  } finally { clearTimeout(timer); }
}

export const searchLeads = filters => request(client().rpc('search_leads_v2', filters));
export const filterOptions = () => request(client().rpc('lead_filter_options_v2'));
export const getLead = id => request(client().from('leads').select('*').eq('id', id).single());
export const getIssues = id => request(client().from('lead_issues').select('issue_tel,issue_rdv').eq('lead_id', id).maybeSingle());
export const getNotes = (id, page = 0) => request(client().from('lead_notes')
  .select('id,text,author_id,created_at,app_users(nom)').eq('lead_id', id)
  .order('created_at', { ascending: false }).order('id').range(page * 50, page * 50 + 49));

export async function saveNote(leadId, text, id) {
  const trimmed = text.trim();
  if (!identity || !trimmed || trimmed.length > 10000) throw new Error('invalid note');
  try {
    return await request(client().from('lead_notes').insert({ id, lead_id: leadId, text: trimmed, author_id: identity.id })
      .select('id').single());
  } catch (error) {
    // Reusing the UUID after a lost response makes retries safe without overwriting a note.
    if (error.code === '23505') {
      const existing = await request(client().from('lead_notes').select('id,text,lead_id,author_id').eq('id', id).single());
      if (existing.text === trimmed && String(existing.lead_id) === String(leadId) && existing.author_id === identity.id) return existing;
    }
    throw error;
  }
}

export function saveIssues(leadId, tel, rdv) {
  return request(client().from('lead_issues').upsert({
    lead_id: leadId, issue_tel: tel, issue_rdv: rdv, updated_by: identity.id, updated_at: new Date().toISOString()
  }, { onConflict: 'lead_id' }));
}

export function getAgenda(page = 0, leadId = null) {
  let query = client().from('agenda').select('*').order('date_rdv').order('id').range(page * 50, page * 50 + 49);
  if (leadId !== null) query = query.eq('lead_id', leadId);
  return request(query);
}

export async function addAgenda(lead, date, time, text, id) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) || text.length > 10000) throw new Error('invalid appointment');
  try {
    return await request(client().from('agenda').insert({
      id, lead_id: lead.id, owner_id: identity.id, siren: lead.siren, societe: lead.societe,
      telephone: lead.telephone, commercial: lead.commercial, priorite: lead.priorite,
      departement: lead.departement == null ? null : String(lead.departement), ville: lead.ville,
      date_rdv: date, heure_rdv: time || null, note_rdv: text
    }).select('id').single());
  } catch (error) {
    if (error.code === '23505') {
      const existing = await request(client().from('agenda').select('id,owner_id,date_rdv,heure_rdv,note_rdv,lead_id').eq('id', id).single());
      if (existing.owner_id === identity.id && existing.date_rdv === date && (existing.heure_rdv || '') === time
        && existing.note_rdv === text && String(existing.lead_id) === String(lead.id)) return existing;
    }
    throw error;
  }
}
export const setAgendaDone = (id, disabled) => request(client().from('agenda').update({ disabled }).eq('id', id).select('id').single());
