import { Router } from 'express';
import { db } from '../db.js';
import { auth, roles, STAFF, MANAGERS } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { checkRefs } from '../lib/tenant.js';
import { makeReference } from '../lib/contacts.js';
import { sendMessage } from '../lib/integrations.js';
import { readUpload, storePrivate, signedUrl, removePrivate, FileError } from '../lib/files.js';
import { DOC_STATUS, canMoveDoc } from '../lib/documents.js';
import { SERVICE_KINDS, SERVICE_STATUS, toDraftListing } from '../lib/services.js';
import { validateOffer, effectiveStatus, notifyOffer, OFFER_STATUS } from '../lib/offers.js';
import { defaultMilestones, validateMilestones, TEMPLATES } from '../lib/transactions.js';
import { cleanListingInput } from '../lib/listing.js';

/**
 * Staff management of customer-raised work:
 *   /api/document-requests   official documents customers ask for
 *   /api/service-requests    landlord / valuation / management / relocation submissions
 *   /api/offers              offers recorded and sent to customers
 *   /api/transactions        customer-visible progress milestones
 */
const router = Router();
router.use(auth, roles(...STAFF));

function fail(res, e) {
  if (e instanceof FileError) return res.status(e.status).json({ error: e.message });
  console.error('staff requests:', e);
  return res.status(500).json({ error: 'Something went wrong. Please try again.' });
}

/** Message the customer, honouring their preferences; the same event never sends twice. */
async function notifyCustomer(companyId, client, text, ref, dedupeKey) {
  const prefs = { whatsapp: true, email: true, ...(client?.notification_prefs || {}) };
  if (client?.verified_phone && prefs.whatsapp) { await sendMessage('whatsapp', client.verified_phone, text, ref, { companyId, dedupeKey: `${dedupeKey}:wa` }); return true; }
  if (client?.verified_email && prefs.email) { await sendMessage('email', client.verified_email, text, ref, { companyId, dedupeKey: `${dedupeKey}:email` }); return true; }
  return false;
}

const companyName = async (id) => (await db.from('companies').select('name').eq('id', id).single()).data?.name || 'Your agency';

// ══════════════════════════ document requests ══════════════════════════
const DOC_SELECT = '*, client:client_id(id,name,verified_phone,verified_email,notification_prefs), property:property_id(id,title)';

router.get('/document-requests', async (req, res) => {
  let q = req.tdb.from('document_requests').select(DOC_SELECT).order('created_at', { ascending: false }).limit(300);
  if (req.query.status && req.query.status !== 'all') q = q.in('status', String(req.query.status).split(',').slice(0, 6));
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

async function loadDoc(req, res) {
  const { data } = await req.tdb.from('document_requests').select(DOC_SELECT).eq('id', req.params.id).maybeSingle();
  if (!data) { res.status(404).json({ error: 'Request not found' }); return null; }
  return data;
}

router.get('/document-requests/:id', async (req, res) => {
  const r = await loadDoc(req, res); if (!r) return;
  const { data: files } = await req.tdb.from('document_request_files').select('id,file_name,mime_type,size_bytes,label,uploaded_by,created_at').eq('request_id', r.id).order('created_at');
  res.json({ ...r, files: files || [] });
});

router.post('/document-requests/:id/status', async (req, res) => {
  const r = await loadDoc(req, res); if (!r) return;
  const status = req.body?.status;
  if (!DOC_STATUS[status] || status === 'cancelled') return res.status(400).json({ error: 'Invalid status' });
  if (!canMoveDoc(r.status, status)) return res.status(409).json({ error: `Cannot move from "${DOC_STATUS[r.status].label}" to "${DOC_STATUS[status].label}"` });
  const message = req.body?.message ? String(req.body.message).trim().slice(0, 1000) : null;
  if (status === 'declined' && !message) return res.status(400).json({ error: 'Tell the customer why it cannot be issued' });
  if (status === 'ready') {
    const { count } = await req.tdb.from('document_request_files').select('id', { count: 'exact', head: true }).eq('request_id', r.id);
    if (!(count || 0)) return res.status(409).json({ error: 'Upload the document before marking it ready' });
  }
  const now = new Date().toISOString();
  const { data } = await req.tdb.from('document_requests').update({ status, customer_message: message, updated_at: now }).eq('id', r.id).select().single();
  let notified = false;
  if (req.body?.notify !== false && ['ready', 'declined'].includes(status)) {
    const name = await companyName(req.user.company_id);
    notified = await notifyCustomer(req.user.company_id, r.client,
      `${name}: your "${r.doc_label}" request (${r.reference}) is ${DOC_STATUS[status].label.toLowerCase()}.${message ? ' ' + message : ''} Sign in to the agency website to view it.`,
      'document', `docreq:${r.id}:${status}:${now}`);
  }
  await audit(req.user, `document_request_${status}`, 'document_request', r.id, { reference: r.reference, document: r.doc_label, notified });
  res.json({ ...data, notified: { sent: notified } });
});

router.post('/document-requests/:id/files', async (req, res) => {
  try {
    const r = await loadDoc(req, res); if (!r) return;
    if (['cancelled'].includes(r.status)) return res.status(409).json({ error: 'This request was cancelled.' });
    const file = readUpload(req.body || {});
    const path = await storePrivate(req.user.company_id, `document-requests/${r.id}`, file);
    const { data: f, error } = await req.tdb.from('document_request_files').insert({
      request_id: r.id, storage_path: path, file_name: file.fileName, mime_type: file.mime, size_bytes: file.size,
      label: String(req.body?.label || '').trim().slice(0, 120) || r.doc_label, uploaded_by: 'staff',
    }).select().single();
    if (error) { await removePrivate([path]); throw new Error(error.message); }
    await audit(req.user, 'document_issued', 'document_request', r.id, { reference: r.reference, file: file.fileName });
    res.status(201).json(f);
  } catch (e) { fail(res, e); }
});

router.get('/document-requests/:id/files/:fileId', async (req, res) => {
  try {
    const r = await loadDoc(req, res); if (!r) return;
    const { data: f } = await req.tdb.from('document_request_files').select('*').eq('id', req.params.fileId).eq('request_id', r.id).maybeSingle();
    if (!f) return res.status(404).json({ error: 'Document not found' });
    const url = await signedUrl(f.storage_path, 60);
    await audit(req.user, 'document_accessed', 'document_request_file', f.id, { reference: r.reference, file: f.file_name });
    res.json({ url, expires_in: 60 });
  } catch (e) { fail(res, e); }
});

router.patch('/document-requests/:id', async (req, res) => {
  const r = await loadDoc(req, res); if (!r) return;
  if (!('staff_note' in (req.body || {}))) return res.status(400).json({ error: 'Nothing to update' });
  const { data } = await req.tdb.from('document_requests').update({ staff_note: String(req.body.staff_note || '').slice(0, 2000) || null, updated_at: new Date().toISOString() }).eq('id', r.id).select().single();
  res.json(data);
});

// ══════════════════════════ service / landlord requests ══════════════════════════
const SVC_SELECT = '*, lead:lead_id(id,name,stage,owner_id, owner:owner_id(name)), client:client_id(id,name), converted:converted_property_id(id,title,listing_status)';

router.get('/service-requests', async (req, res) => {
  let q = req.tdb.from('service_requests').select(SVC_SELECT).order('created_at', { ascending: false }).limit(300);
  if (req.query.status && req.query.status !== 'all') q = q.in('status', String(req.query.status).split(',').slice(0, 4));
  if (req.query.kind && req.query.kind !== 'all') q = q.eq('kind', String(req.query.kind));
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  let rows = data || [];
  if (req.user.role === 'agent') rows = rows.filter((r) => r.lead?.owner_id === req.user.id);
  res.json(rows.map((r) => ({ ...r, kind_label: SERVICE_KINDS[r.kind]?.label || r.kind })));
});

async function loadSvc(req, res) {
  const { data } = await req.tdb.from('service_requests').select(SVC_SELECT).eq('id', req.params.id).maybeSingle();
  if (!data) { res.status(404).json({ error: 'Request not found' }); return null; }
  if (req.user.role === 'agent' && data.lead?.owner_id !== req.user.id) { res.status(404).json({ error: 'Request not found' }); return null; }
  return data;
}

router.post('/service-requests/:id/status', async (req, res) => {
  const r = await loadSvc(req, res); if (!r) return;
  const status = req.body?.status;
  if (!SERVICE_STATUS[status]) return res.status(400).json({ error: 'Invalid status' });
  const message = req.body?.message ? String(req.body.message).trim().slice(0, 1000) : null;
  const { data } = await req.tdb.from('service_requests').update({ status, customer_message: message, updated_at: new Date().toISOString() }).eq('id', r.id).select().single();
  // the customer follows this with their reference on the tracking page
  if (message && r.enquiry_id) {
    const { data: e } = await req.tdb.from('enquiries').select('conversation_id').eq('id', r.enquiry_id).maybeSingle();
    if (e?.conversation_id) {
      await req.tdb.child('messages').insert({ conversation_id: e.conversation_id, direction: 'out', body: message, sender_type: 'agent', sender_id: req.user.id });
      await req.tdb.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', e.conversation_id);
    }
  }
  await audit(req.user, `service_request_${status}`, 'service_request', r.id, { reference: r.reference, kind: r.kind });
  res.json(data);
});

/** Turn a landlord submission into a DRAFT listing. Never published, never verified. */
router.post('/service-requests/:id/convert', roles(...MANAGERS), async (req, res) => {
  const r = await loadSvc(req, res); if (!r) return;
  if (r.kind !== 'list_property') return res.status(409).json({ error: 'Only "list my property" submissions can become a listing' });
  if (r.converted_property_id) return res.status(409).json({ error: 'This submission already has a draft listing', property_id: r.converted_property_id });
  const { patch, errors } = cleanListingInput({ ...toDraftListing(r), ...(req.body || {}) }, { partial: false });
  if (errors.length) return res.status(400).json({ error: errors.join(', ') });
  const { data: prop, error } = await req.tdb.from('properties').insert({ ...patch, listing_status: 'draft', updated_at: new Date().toISOString() }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  await req.tdb.from('service_requests').update({ converted_property_id: prop.id, status: 'in_progress', updated_at: new Date().toISOString() }).eq('id', r.id);
  await audit(req.user, 'service_request_converted', 'service_request', r.id, { reference: r.reference, property: prop.title });
  res.status(201).json({ property: prop });
});

router.patch('/service-requests/:id', async (req, res) => {
  const r = await loadSvc(req, res); if (!r) return;
  if (!('staff_note' in (req.body || {}))) return res.status(400).json({ error: 'Nothing to update' });
  const { data } = await req.tdb.from('service_requests').update({ staff_note: String(req.body.staff_note || '').slice(0, 2000) || null, updated_at: new Date().toISOString() }).eq('id', r.id).select().single();
  res.json(data);
});

// ══════════════════════════ offers ══════════════════════════
const OFFER_SELECT = '*, client:client_id(id,name,verified_phone,verified_email,notification_prefs), property:property_id(id,title), creator:created_by(name)';

router.get('/offers', async (req, res) => {
  const { data, error } = await req.tdb.from('offers').select(OFFER_SELECT).order('created_at', { ascending: false }).limit(300);
  if (error) return res.status(500).json({ error: error.message });
  res.json((data || []).map((o) => ({ ...o, effective_status: effectiveStatus(o) })));
});

async function loadOffer(req, res) {
  const { data } = await req.tdb.from('offers').select(OFFER_SELECT).eq('id', req.params.id).maybeSingle();
  if (!data) { res.status(404).json({ error: 'Offer not found' }); return null; }
  return data;
}

router.post('/offers', roles(...MANAGERS), async (req, res) => {
  const b = req.body || {};
  if (!b.client_id || !b.property_id) return res.status(400).json({ error: 'Choose a customer and a property' });
  if (!(await checkRefs(req, res, { client_id: 'clients', property_id: 'properties', application_id: 'applications', deal_id: 'deals' }))) return;
  const { patch, errors } = validateOffer(b);
  if (errors.length) return res.status(400).json({ error: errors.join('. ') });
  const { data, error } = await req.tdb.from('offers').insert({
    reference: makeReference(), client_id: b.client_id, property_id: b.property_id,
    application_id: b.application_id || null, deal_id: b.deal_id || null,
    created_by: req.user.id, status: 'draft', ...patch,
  }).select(OFFER_SELECT).single();
  if (error) return res.status(500).json({ error: error.message });
  await audit(req.user, 'offer_created', 'offer', data.id, { reference: data.reference, amount: data.amount });
  res.status(201).json(data);
});

router.patch('/offers/:id', roles(...MANAGERS), async (req, res) => {
  const o = await loadOffer(req, res); if (!o) return;
  const b = req.body || {};
  const patch = {};
  if ('staff_note' in b) patch.staff_note = String(b.staff_note || '').slice(0, 2000) || null;
  if ('amount' in b || 'terms' in b || 'expires_at' in b) {
    if (o.status !== 'draft') return res.status(409).json({ error: 'Only a draft offer can be edited. Withdraw it and create a new one.' });
    const { patch: p, errors } = validateOffer(b, { partial: true });
    if (errors.length) return res.status(400).json({ error: errors.join('. ') });
    Object.assign(patch, p);
  }
  if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to update' });
  patch.updated_at = new Date().toISOString();
  const { data } = await req.tdb.from('offers').update(patch).eq('id', o.id).select(OFFER_SELECT).single();
  res.json(data);
});

router.post('/offers/:id/send', roles(...MANAGERS), async (req, res) => {
  const o = await loadOffer(req, res); if (!o) return;
  if (o.status !== 'draft') return res.status(409).json({ error: `This offer is already ${OFFER_STATUS[o.status].label.toLowerCase()}` });
  const now = new Date().toISOString();
  const { data } = await req.tdb.from('offers').update({ status: 'sent', updated_at: now }).eq('id', o.id).eq('status', 'draft').select().maybeSingle();
  if (!data) return res.status(409).json({ error: 'This offer was already sent' });
  const notified = req.body?.notify === false ? { sent: false } : await notifyOffer(req.user.company_id, data, o.client);
  await audit(req.user, 'offer_sent', 'offer', o.id, { reference: o.reference, amount: o.amount, notified: notified.sent });
  res.json({ ...data, notified: { sent: notified.sent } });
});

router.post('/offers/:id/withdraw', roles(...MANAGERS), async (req, res) => {
  const o = await loadOffer(req, res); if (!o) return;
  if (!['draft', 'sent'].includes(o.status)) return res.status(409).json({ error: 'Only a draft or sent offer can be withdrawn' });
  const now = new Date().toISOString();
  const { data } = await req.tdb.from('offers').update({ status: 'withdrawn', updated_at: now }).eq('id', o.id).select().single();
  const notified = o.status === 'sent' && req.body?.notify !== false ? await notifyOffer(req.user.company_id, data, o.client) : { sent: false };
  await audit(req.user, 'offer_withdrawn', 'offer', o.id, { reference: o.reference });
  res.json({ ...data, notified: { sent: notified.sent } });
});

// ══════════════════════════ transactions ══════════════════════════
const TX_SELECT = '*, client:client_id(id,name), property:property_id(id,title), deal:deal_id(id,title,status)';

router.get('/transactions', async (req, res) => {
  const { data, error } = await req.tdb.from('transactions').select(TX_SELECT).order('created_at', { ascending: false }).limit(300);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

router.get('/transactions/templates', (req, res) => res.json(TEMPLATES));

router.post('/transactions', async (req, res) => {
  const b = req.body || {};
  if (!b.client_id || !['sale', 'rental'].includes(b.kind)) return res.status(400).json({ error: 'Choose a customer and whether this is a sale or a rental' });
  if (!(await checkRefs(req, res, { client_id: 'clients', property_id: 'properties', deal_id: 'deals' }))) return;
  const { data, error } = await req.tdb.from('transactions').insert({
    reference: makeReference(), client_id: b.client_id, property_id: b.property_id || null, deal_id: b.deal_id || null,
    kind: b.kind, milestones: defaultMilestones(b.kind),
  }).select(TX_SELECT).single();
  if (error) return res.status(500).json({ error: error.message });
  await audit(req.user, 'transaction_created', 'transaction', data.id, { reference: data.reference, kind: b.kind });
  res.status(201).json(data);
});

router.patch('/transactions/:id', async (req, res) => {
  const { data: t } = await req.tdb.from('transactions').select('*').eq('id', req.params.id).maybeSingle();
  if (!t) return res.status(404).json({ error: 'Transaction not found' });
  const b = req.body || {};
  const patch = {};
  if ('milestones' in b) {
    const { milestones, errors } = validateMilestones(b.milestones);
    if (errors.length) return res.status(400).json({ error: errors.join('. ') });
    patch.milestones = milestones;
  }
  if ('customer_message' in b) patch.customer_message = String(b.customer_message || '').trim().slice(0, 1000) || null;
  if ('staff_note' in b) patch.staff_note = String(b.staff_note || '').slice(0, 2000) || null;
  if ('status' in b) {
    if (!['active', 'completed', 'cancelled'].includes(b.status)) return res.status(400).json({ error: 'Invalid status' });
    patch.status = b.status;
  }
  if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to update' });
  patch.updated_at = new Date().toISOString();
  const { data } = await req.tdb.from('transactions').update(patch).eq('id', t.id).select(TX_SELECT).single();
  await audit(req.user, 'transaction_updated', 'transaction', t.id, { reference: t.reference, changes: Object.keys(patch) });
  res.json(data);
});

export default router;
