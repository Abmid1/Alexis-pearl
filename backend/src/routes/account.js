import { Router } from 'express';
import { rateLimit } from '../middleware/rateLimit.js';
import { requestCode, verifyCode, customerAuth, toCustomer, AuthError } from '../lib/customerAuth.js';
import { phoneVariants, likeExact } from '../lib/contacts.js';
import { getPublicProperty } from '../lib/publicSearch.js';
import { toPublicProperty, isPublic } from '../lib/listing.js';
import { submitEnquiry, EnquiryError, toPublicEnquiry } from '../lib/enquiry.js';
import { toPublicViewing } from '../lib/viewings.js';
import { hoursFor, withinCustomerCutoff } from '../lib/scheduling.js';
import { validateAnswers, toPublicApplication, OPEN_STATUSES, CUSTOMER_UPLOAD_STATUSES } from '../lib/applications.js';
import { readUpload, storePrivate, signedUrl, removePrivate, FileError } from '../lib/files.js';
import { audit } from '../lib/audit.js';
import { toPublicLease, toPublicRentPayment, toPublicTicket, validateMaintenance } from '../lib/tenancy.js';
import { publicCatalogue, toPublicDocumentRequest, DOC_OPEN } from '../lib/documents.js';
import { toPublicOffer, effectiveStatus } from '../lib/offers.js';
import { toPublicTransaction } from '../lib/transactions.js';
import { makeReference } from '../lib/contacts.js';

/**
 * Customer accounts on the public agency site: /api/public/:slug/account/…
 * req.company / req.tdb are set by the public router from the slug.
 * Everything after sign-in is limited to req.client — the signed-in customer.
 */
const router = Router({ mergeParams: true });
const codeLimit = rateLimit({ name: 'otp-request', windowMs: 15 * 60000, max: 8 });
const verifyLimit = rateLimit({ name: 'otp-verify', windowMs: 15 * 60000, max: 20 });
const uploadLimit = rateLimit({ name: 'doc-upload', windowMs: 60 * 60000, max: 30 });
const maintLimit = rateLimit({ name: 'maintenance', windowMs: 60 * 60000, max: 20 });
const docReqLimit = rateLimit({ name: 'doc-request', windowMs: 60 * 60000, max: 20 });

router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

function fail(res, e) {
  if (e instanceof AuthError || e instanceof EnquiryError || e instanceof FileError) return res.status(e.status).json({ error: e.message });
  console.error('account route:', e);
  return res.status(500).json({ error: 'Something went wrong. Please try again.' });
}

router.post('/code', codeLimit, async (req, res) => {
  try {
    const r = await requestCode(req.company, req.body?.contact);
    res.json({ ok: true, ...r, message: `If ${r.sent_to} can receive messages, a 6-digit code is on its way.` });
  } catch (e) { fail(res, e); }
});

router.post('/verify', verifyLimit, async (req, res) => {
  try { res.json(await verifyCode(req.company, req.body?.contact, req.body?.code, { name: req.body?.name })); } catch (e) { fail(res, e); }
});

// ── signed-in customer only ───────────────────────────────────────────
router.use(customerAuth);

router.get('/me', (req, res) => res.json({ customer: toCustomer(req.client) }));

/** Name and notification preferences. Contact details change only by signing in with the new one. */
router.patch('/me', async (req, res) => {
  const patch = {};
  if ('name' in (req.body || {})) {
    const n = String(req.body.name || '').trim().slice(0, 80);
    if (n.length < 2) return res.status(400).json({ error: 'Please enter your name' });
    patch.name = n;
  }
  if (req.body?.notification_prefs && typeof req.body.notification_prefs === 'object') {
    patch.notification_prefs = { whatsapp: !!req.body.notification_prefs.whatsapp, email: !!req.body.notification_prefs.email };
  }
  if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to update' });
  const { data } = await req.tdb.from('clients').update(patch).eq('id', req.client.id).select().single();
  res.json({ customer: toCustomer(data) });
});

/** Enquiries made with a contact this customer has PROVEN (verified) — never by name or unverified fields. */
async function myEnquiries(req) {
  const c = req.client;
  const [byPhone, byEmail] = await Promise.all([
    c.verified_phone ? req.tdb.from('enquiries').select('*').in('phone', phoneVariants(c.verified_phone)) : { data: [] },
    c.verified_email ? req.tdb.from('enquiries').select('*').ilike('email', likeExact(c.verified_email)) : { data: [] },
  ]);
  const map = new Map();
  [...(byPhone.data || []), ...(byEmail.data || [])].forEach((e) => map.set(e.id, e));
  return [...map.values()].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
}

async function propsById(req, ids) {
  const list = [...new Set(ids.filter(Boolean))];
  if (!list.length) return new Map();
  const { data } = await req.tdb.from('properties').select('id,title,listing_status,archived_at').in('id', list);
  return new Map((data || []).map((p) => [p.id, p]));
}

router.get('/overview', async (req, res) => {
  const enquiries = await myEnquiries(req);
  const ids = enquiries.map((e) => e.id);
  const [{ data: views }, { data: apps }, saved, leaseCount, docCount, offerRows, txCount] = await Promise.all([
    ids.length ? req.tdb.from('viewings').select('*').in('enquiry_id', ids).order('starts_at') : { data: [] },
    req.tdb.from('applications').select('*').eq('client_id', req.client.id).order('created_at', { ascending: false }),
    savedList(req),
    req.tdb.from('leases').select('id', { count: 'exact', head: true }).eq('client_id', req.client.id),
    req.tdb.from('document_requests').select('id', { count: 'exact', head: true }).eq('client_id', req.client.id),
    req.tdb.from('offers').select('*').eq('client_id', req.client.id).neq('status', 'draft'),
    req.tdb.from('transactions').select('id', { count: 'exact', head: true }).eq('client_id', req.client.id),
  ]);
  const props = await propsById(req, [...enquiries.map((e) => e.property_id), ...(apps || []).map((a) => a.property_id)]);
  const pub = (id) => { const p = props.get(id); return p ? { id: isPublic(p) ? p.id : null, title: p.title } : null; };
  const hours = hoursFor(req.company);
  res.json({
    customer: toCustomer(req.client),
    enquiries: enquiries.filter((e) => e.kind !== 'application').map((e) => ({
      ...toPublicEnquiry(e, pub(e.property_id)),
      viewings: (views || []).filter((v) => v.enquiry_id === e.id).map((v) => ({
        ...toPublicViewing(v, { property: pub(v.property_id) }),
        can_change: ['requested', 'confirmed'].includes(v.status) && withinCustomerCutoff(hours, v.starts_at),
      })),
    })),
    applications: (apps || []).map((a) => toPublicApplication(a, { property: pub(a.property_id) })),
    saved,
    has_tenancy: (leaseCount.count || 0) > 0,
    document_requests: docCount.count || 0,
    offers: (offerRows.data || []).length,
    offers_awaiting: (offerRows.data || []).filter((o) => effectiveStatus(o) === 'sent').length,
    transactions: txCount.count || 0,
  });
});

// ── saved homes ──
async function savedList(req) {
  const { data: rows } = await req.tdb.from('saved_properties').select('property_id,created_at').eq('client_id', req.client.id).order('created_at', { ascending: false });
  const out = [];
  for (const r of rows || []) {
    const p = await getPublicProperty(req.company.id, r.property_id);
    if (p) out.push(toPublicProperty(p));            // unpublished/archived listings drop out automatically
  }
  return out;
}

router.get('/saved', async (req, res) => res.json({ items: await savedList(req) }));

async function save(req, propertyId) {
  const p = await getPublicProperty(req.company.id, propertyId);
  if (!p) return false;
  const { data: exists } = await req.tdb.from('saved_properties').select('id').eq('client_id', req.client.id).eq('property_id', p.id).maybeSingle();
  if (!exists) await req.tdb.from('saved_properties').insert({ client_id: req.client.id, property_id: p.id });
  return true;
}

router.post('/saved', async (req, res) => {
  if (!(await save(req, req.body?.property_id))) return res.status(404).json({ error: 'This property is not listed' });
  res.json({ ok: true });
});

/** Merge homes saved on this device before signing in. */
router.post('/saved/sync', async (req, res) => {
  const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).filter((x) => typeof x === 'string').slice(0, 50);
  for (const id of ids) await save(req, id);
  res.json({ items: await savedList(req) });
});

router.delete('/saved/:propertyId', async (req, res) => {
  await req.tdb.from('saved_properties').delete().eq('client_id', req.client.id).eq('property_id', req.params.propertyId);
  res.json({ ok: true });
});

// ── applications ──
router.get('/form', (req, res) => res.json({ form: req.company.application_form || [] }));

async function myApplication(req, res) {
  const { data: a } = await req.tdb.from('applications').select('*').eq('id', req.params.id).eq('client_id', req.client.id).maybeSingle();
  if (!a) { res.status(404).json({ error: 'Application not found' }); return null; }
  return a;
}

router.post('/applications', async (req, res) => {
  try {
    const body = req.body || {};
    const idem = typeof body.idempotency_key === 'string' && /^[\w-]{8,64}$/.test(body.idempotency_key) ? body.idempotency_key : null;
    if (idem) {
      const { data: prior } = await req.tdb.from('applications').select('*').eq('idempotency_key', idem).eq('client_id', req.client.id).maybeSingle();
      if (prior) return res.json({ application: toPublicApplication(prior), duplicate: true });
    }
    const p = await getPublicProperty(req.company.id, body.property_id);
    if (!p) return res.status(404).json({ error: 'This property is no longer listed' });
    if (!['available', 'under_offer'].includes(p.availability)) return res.status(409).json({ error: `This property is ${String(p.availability).replace('_', ' ')} and is not taking applications` });
    const form = req.company.application_form || [];
    const { answers, errors } = validateAnswers(form, body.answers);
    if (errors.length) return res.status(400).json({ error: errors.join('. ') });
    const { data: open } = await req.tdb.from('applications').select('id,reference').eq('client_id', req.client.id).eq('property_id', p.id).in('status', OPEN_STATUSES).maybeSingle();
    if (open) return res.status(409).json({ error: `You already have an open application for this property (${open.reference}).`, application_id: open.id });

    const kind = p.ptype === 'rent' ? 'rental' : 'purchase';
    const c = req.client;
    const prefs = { whatsapp: true, email: true, ...(c.notification_prefs || {}) };
    const summary = form.filter((q) => answers[q.key] != null).map((q) => `${q.label}: ${answers[q.key]}`).join('\n');
    const r = await submitEnquiry(req.company, {
      property_id: p.id, name: c.name, phone: c.verified_phone, email: c.verified_email,
      message: summary || null, consent: prefs.whatsapp || prefs.email, idempotency_key: idem ? `app-${idem}`.slice(0, 64) : null,
    }, { kind: 'application', source: 'portal', describe: ({ property }) => `${kind === 'rental' ? 'Rental' : 'Purchase'} application for "${property.title}"` });
    const { data: app, error } = await req.tdb.from('applications').insert({
      reference: r.enquiry.reference, client_id: c.id, property_id: p.id, lead_id: r.enquiry.lead_id, enquiry_id: r.enquiry.id,
      kind, answers, idempotency_key: idem,
    }).select().single();
    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'You already have an open application for this property.' });
      throw new Error(error.message);
    }
    await audit({ id: null, name: c.name, company_id: req.company.id }, 'application_submitted', 'application', app.id, { reference: app.reference, property: p.title });
    res.status(201).json({ application: toPublicApplication(app, { property: p }) });
  } catch (e) { fail(res, e); }
});

router.get('/applications/:id', async (req, res) => {
  const a = await myApplication(req, res); if (!a) return;
  const [{ data: docs }, props] = await Promise.all([
    req.tdb.from('application_documents').select('*').eq('application_id', a.id).order('created_at'),
    propsById(req, [a.property_id]),
  ]);
  const p = props.get(a.property_id);
  res.json({ application: toPublicApplication(a, { property: p ? { id: isPublic(p) ? p.id : null, title: p.title } : null, documents: docs, form: req.company.application_form || [] }) });
});

async function threadNote(req, a, body) {
  if (!a.enquiry_id) return;
  const { data: e } = await req.tdb.from('enquiries').select('conversation_id').eq('id', a.enquiry_id).maybeSingle();
  if (!e?.conversation_id) return;
  await req.tdb.child('messages').insert({ conversation_id: e.conversation_id, direction: 'in', sender_type: 'contact', body });
  await req.tdb.from('conversations').update({ unread: true, last_message_at: new Date().toISOString() }).eq('id', e.conversation_id);
}

router.post('/applications/:id/documents', uploadLimit, async (req, res) => {
  try {
    const a = await myApplication(req, res); if (!a) return;
    if (!CUSTOMER_UPLOAD_STATUSES.includes(a.status)) return res.status(409).json({ error: 'This application is closed for new documents.' });
    const { count } = await req.tdb.from('application_documents').select('id', { count: 'exact', head: true }).eq('application_id', a.id);
    if ((count || 0) >= 20) return res.status(409).json({ error: 'You can upload up to 20 documents per application.' });
    const file = readUpload(req.body || {});
    const label = String(req.body?.label || '').trim().slice(0, 120) || null;
    const path = await storePrivate(req.company.id, `applications/${a.id}`, file);
    const { data: doc, error } = await req.tdb.from('application_documents').insert({
      application_id: a.id, storage_path: path, file_name: file.fileName, mime_type: file.mime, size_bytes: file.size, label, uploaded_by: 'customer',
    }).select().single();
    if (error) { await removePrivate([path]); throw new Error(error.message); }
    await threadNote(req, a, `Uploaded a document for application ${a.reference}: ${file.fileName}${label ? ` (${label})` : ''}`);
    await audit({ id: null, name: req.client.name, company_id: req.company.id }, 'document_uploaded', 'application', a.id, { file: file.fileName, size: file.size, label });
    res.status(201).json({ document: { id: doc.id, file_name: doc.file_name, label: doc.label, size_bytes: doc.size_bytes, uploaded_by: 'customer', created_at: doc.created_at } });
  } catch (e) { fail(res, e); }
});

/** A 60-second download link to the customer's OWN document. */
router.get('/applications/:id/documents/:docId', async (req, res) => {
  try {
    const a = await myApplication(req, res); if (!a) return;
    const { data: d } = await req.tdb.from('application_documents').select('*').eq('id', req.params.docId).eq('application_id', a.id).maybeSingle();
    if (!d) return res.status(404).json({ error: 'Document not found' });
    const url = await signedUrl(d.storage_path, 60);
    await audit({ id: null, name: req.client.name, company_id: req.company.id }, 'document_accessed', 'application_document', d.id, { by: 'customer' });
    res.json({ url, expires_in: 60 });
  } catch (e) { fail(res, e); }
});

router.post('/applications/:id/withdraw', async (req, res) => {
  const a = await myApplication(req, res); if (!a) return;
  if (!OPEN_STATUSES.includes(a.status)) return res.status(409).json({ error: 'This application can no longer be withdrawn.' });
  const { data } = await req.tdb.from('applications').update({ status: 'withdrawn', updated_at: new Date().toISOString() }).eq('id', a.id).select().single();
  await threadNote(req, a, `Customer withdrew application ${a.reference}.`);
  await audit({ id: null, name: req.client.name, company_id: req.company.id }, 'application_withdrawn', 'application', a.id, { reference: a.reference });
  res.json({ application: toPublicApplication(data) });
});

// ── existing tenants: rent + maintenance (built on staff-managed leases/tickets) ──
async function myLeases(req) {
  const { data } = await req.tdb.from('leases')
    .select('*, property:property_id(title,location), unit:unit_id(name)')
    .eq('client_id', req.client.id).order('end_date', { ascending: false });
  return data || [];
}

router.get('/tenancy', async (req, res) => {
  const now = new Date();
  const leases = await myLeases(req);
  const [{ data: payments }, { data: tickets }] = await Promise.all([
    req.tdb.from('payments').select('*').eq('client_id', req.client.id).not('lease_id', 'is', null).eq('status', 'approved').order('created_at', { ascending: false }),
    req.tdb.from('tickets').select('*, property:property_id(title), unit:unit_id(name)').eq('client_id', req.client.id).order('created_at', { ascending: false }),
  ]);
  res.json({
    leases: leases.map((l) => toPublicLease(l, { payments: payments || [], now })),
    payments: (payments || []).map(toPublicRentPayment),
    maintenance: (tickets || []).map(toPublicTicket),
  });
});

/** Report a maintenance problem → creates a ticket on a property the customer actually leases. */
router.post('/maintenance', maintLimit, async (req, res) => {
  try {
    const { errors, value } = validateMaintenance(req.body || {});
    if (errors.length) return res.status(400).json({ error: errors.join('. ') });
    const leases = await myLeases(req);
    const active = leases.filter((l) => l.status !== 'ended');
    if (!active.length) return res.status(409).json({ error: 'You have no active tenancy to report maintenance for.' });
    let lease = active[0];
    if (req.body?.lease_id) {
      lease = active.find((l) => l.id === req.body.lease_id);
      if (!lease) return res.status(404).json({ error: 'Tenancy not found' });
    }
    const { count } = await req.tdb.from('tickets').select('id', { count: 'exact', head: true }).eq('client_id', req.client.id).eq('status', 'open');
    if ((count || 0) >= 20) return res.status(409).json({ error: 'You already have several open requests. Please wait for the agency to respond.' });
    const { data: ticket, error } = await req.tdb.from('tickets').insert({
      property_id: lease.property_id, unit_id: lease.unit_id, client_id: req.client.id,
      title: value.title, description: value.description, status: 'open',   // owner_id null until staff assign
    }).select('*, property:property_id(title), unit:unit_id(name)').single();
    if (error) throw new Error(error.message);
    await audit({ id: null, name: req.client.name, company_id: req.company.id }, 'maintenance_reported', 'ticket', ticket.id, { title: value.title, property: lease.property?.title });
    res.status(201).json({ ticket: toPublicTicket(ticket) });
  } catch (e) { fail(res, e); }
});

// ── document requests (payment statement, allocation letter, permission to build…) ──
router.get('/documents', async (req, res) => {
  const { data: reqs } = await req.tdb.from('document_requests').select('*').eq('client_id', req.client.id).order('created_at', { ascending: false });
  const ids = (reqs || []).map((r2) => r2.id);
  const { data: files } = ids.length
    ? await req.tdb.from('document_request_files').select('*').in('request_id', ids).order('created_at')
    : { data: [] };
  const props = await propsById(req, (reqs || []).map((r2) => r2.property_id));
  res.json({
    catalogue: publicCatalogue(req.company),
    requests: (reqs || []).map((r2) => toPublicDocumentRequest(r2, {
      property: props.get(r2.property_id) || null,
      files: (files || []).filter((f) => f.request_id === r2.id),
    })),
  });
});

router.post('/documents', docReqLimit, async (req, res) => {
  try {
    const body = req.body || {};
    const idem = typeof body.idempotency_key === 'string' && /^[\w-]{8,64}$/.test(body.idempotency_key) ? body.idempotency_key : null;
    if (idem) {
      const { data: prior } = await req.tdb.from('document_requests').select('*').eq('idempotency_key', idem).eq('client_id', req.client.id).maybeSingle();
      if (prior) return res.json({ request: toPublicDocumentRequest(prior), duplicate: true });
    }
    const entry = publicCatalogue(req.company).find((d) => d.key === body.doc_key);
    if (!entry) return res.status(404).json({ error: 'That document is not offered by this agency' });
    // a property may be named, but only one this customer is actually connected to
    let property = null;
    if (body.property_id) {
      const { data: p } = await req.tdb.from('properties').select('id,title').eq('id', body.property_id).maybeSingle();
      if (!p) return res.status(404).json({ error: 'Property not found' });
      const [{ count: leased }, { count: applied }] = await Promise.all([
        req.tdb.from('leases').select('id', { count: 'exact', head: true }).eq('client_id', req.client.id).eq('property_id', p.id),
        req.tdb.from('applications').select('id', { count: 'exact', head: true }).eq('client_id', req.client.id).eq('property_id', p.id),
      ]);
      if (!(leased || 0) && !(applied || 0)) return res.status(403).json({ error: 'You can only request documents for a property you rent or have applied for.' });
      property = p;
    }
    const { count: open } = await req.tdb.from('document_requests').select('id', { count: 'exact', head: true }).eq('client_id', req.client.id).in('status', DOC_OPEN);
    if ((open || 0) >= 10) return res.status(409).json({ error: 'You already have several open document requests. Please wait for the agency.' });
    const { data: created, error } = await req.tdb.from('document_requests').insert({
      reference: makeReference(), client_id: req.client.id, property_id: property?.id || null,
      doc_key: entry.key, doc_label: entry.label, category: entry.category, fee: entry.fee || 0,
      turnaround_days: entry.turnaround_days ?? null,
      customer_note: String(body.note || '').trim().slice(0, 1000) || null, idempotency_key: idem,
    }).select().single();
    if (error) {
      if (error.code === '23505' && idem) {
        const { data: prior } = await req.tdb.from('document_requests').select('*').eq('idempotency_key', idem).maybeSingle();
        if (prior) return res.json({ request: toPublicDocumentRequest(prior), duplicate: true });
      }
      throw new Error(error.message);
    }
    await audit({ id: null, name: req.client.name, company_id: req.company.id }, 'document_requested', 'document_request', created.id, { reference: created.reference, document: entry.label });
    res.status(201).json({ request: toPublicDocumentRequest(created, { property }) });
  } catch (e) { fail(res, e); }
});

router.post('/documents/:id/cancel', async (req, res) => {
  const { data: r2 } = await req.tdb.from('document_requests').select('*').eq('id', req.params.id).eq('client_id', req.client.id).maybeSingle();
  if (!r2) return res.status(404).json({ error: 'Request not found' });
  if (!DOC_OPEN.includes(r2.status)) return res.status(409).json({ error: 'This request can no longer be cancelled.' });
  const { data } = await req.tdb.from('document_requests').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', r2.id).select().single();
  await audit({ id: null, name: req.client.name, company_id: req.company.id }, 'document_request_cancelled', 'document_request', r2.id, { reference: r2.reference });
  res.json({ request: toPublicDocumentRequest(data) });
});

/** 60-second link to a document the agency issued to this customer. */
router.get('/documents/:id/files/:fileId', async (req, res) => {
  try {
    const { data: r2 } = await req.tdb.from('document_requests').select('id,reference').eq('id', req.params.id).eq('client_id', req.client.id).maybeSingle();
    if (!r2) return res.status(404).json({ error: 'Request not found' });
    const { data: f } = await req.tdb.from('document_request_files').select('*').eq('id', req.params.fileId).eq('request_id', r2.id).maybeSingle();
    if (!f) return res.status(404).json({ error: 'Document not found' });
    const url = await signedUrl(f.storage_path, 60);
    await audit({ id: null, name: req.client.name, company_id: req.company.id }, 'document_accessed', 'document_request_file', f.id, { by: 'customer', reference: r2.reference });
    res.json({ url, expires_in: 60 });
  } catch (e) { fail(res, e); }
});

// ── offers ──
router.get('/offers', async (req, res) => {
  const { data: rows } = await req.tdb.from('offers').select('*').eq('client_id', req.client.id).neq('status', 'draft').order('created_at', { ascending: false });
  const props = await propsById(req, (rows || []).map((o) => o.property_id));
  res.json({ offers: (rows || []).map((o) => toPublicOffer(o, { property: props.get(o.property_id) || null })) });
});

/** Accept or decline. This records intent only — it is not a contract. */
router.post('/offers/:id/respond', async (req, res) => {
  const accept = req.body?.accept;
  if (typeof accept !== 'boolean') return res.status(400).json({ error: 'Choose accept or decline' });
  const { data: o } = await req.tdb.from('offers').select('*').eq('id', req.params.id).eq('client_id', req.client.id).maybeSingle();
  if (!o) return res.status(404).json({ error: 'Offer not found' });
  if (effectiveStatus(o) !== 'sent') return res.status(409).json({ error: 'This offer is no longer open for a response.' });
  const now = new Date().toISOString();
  const { data } = await req.tdb.from('offers').update({
    status: accept ? 'accepted' : 'declined', responded_at: now, updated_at: now,
    customer_response_note: String(req.body?.note || '').trim().slice(0, 1000) || null,
  }).eq('id', o.id).eq('status', 'sent').select().maybeSingle();
  if (!data) return res.status(409).json({ error: 'This offer is no longer open for a response.' });
  await audit({ id: null, name: req.client.name, company_id: req.company.id }, accept ? 'offer_accepted' : 'offer_declined', 'offer', o.id, { reference: o.reference, amount: o.amount });
  res.json({ offer: toPublicOffer(data) });
});

// ── transaction progress ──
router.get('/transactions', async (req, res) => {
  const { data: rows } = await req.tdb.from('transactions').select('*').eq('client_id', req.client.id).order('created_at', { ascending: false });
  const props = await propsById(req, (rows || []).map((t) => t.property_id));
  res.json({ transactions: (rows || []).map((t) => toPublicTransaction(t, { property: props.get(t.property_id) || null })) });
});

export default router;
