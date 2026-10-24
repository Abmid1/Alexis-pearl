import { Router } from 'express';
import { companyBySlug, tenantDb } from '../lib/tenant.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { parseFilters, searchProperties, getPublicProperty, relatedProperties, facets, sitemapEntries } from '../lib/publicSearch.js';
import { toPublicProperty, isPublic, publicAvailability } from '../lib/listing.js';
import { submitEnquiry, EnquiryError, toPublicEnquiry } from '../lib/enquiry.js';
import { hoursFor, generateSlots, findSlot, withinCustomerCutoff, overlaps } from '../lib/scheduling.js';
import { toPublicViewing } from '../lib/viewings.js';
import { contactMatches } from '../lib/contacts.js';
import { audit } from '../lib/audit.js';
import { assistantReply } from '../lib/assistant.js';

/**
 * Public customer-facing API: /api/public/:slug/…
 * No login. The company is resolved from the slug on the server; only published,
 * whitelisted data leaves. Private records need reference + matching phone/email.
 */
const router = Router({ mergeParams: true });

const writeLimit = rateLimit({ name: 'public-write', windowMs: 10 * 60000, max: 12 });
const lookupLimit = rateLimit({ name: 'public-lookup', windowMs: 15 * 60000, max: 15 });
const readLimit = rateLimit({ name: 'public-read', windowMs: 60000, max: 240 });
const aiLimit = rateLimit({ name: 'public-ai', windowMs: 10 * 60000, max: 30 });

/** Resolve the company once per request. Unknown or disabled → 404, nothing else revealed. */
router.use(async (req, res, next) => {
  const company = await companyBySlug(req.params.slug);
  if (!company) return res.status(404).json({ error: 'Agency not found' });
  req.company = company;
  req.tdb = tenantDb(company.id);
  next();
});

// public reads may be cached briefly (URL contains the slug, so caches never mix companies);
// anything personal is marked no-store.
const publicCache = (res, secs = 30) => res.set('Cache-Control', `public, max-age=${secs}, s-maxage=${secs * 2}`);
const noStore = (res) => res.set('Cache-Control', 'no-store');

/** Company profile — strictly the public branding fields. */
export function toPublicCompany(c) {
  const h = hoursFor(c);
  return {
    slug: c.slug, name: c.name, logo_url: c.logo_url || null, brand_color: c.brand_color || '#4038B8',
    tagline: c.tagline || null, about: c.about || null,
    contact_phone: c.contact_phone || null, contact_email: c.contact_email || null, whatsapp: c.whatsapp || null,
    address: c.address || null, office_hours: c.office_hours || null,
    socials: c.socials || {}, services: Array.isArray(c.services) ? c.services : ['buy', 'rent'],
    viewing_policy: { days: h.days, start: h.start, end: h.end, slot_minutes: h.slot_minutes, min_notice_hours: h.min_notice_hours, cancel_cutoff_hours: h.cancel_cutoff_hours },
  };
}

router.get('/', readLimit, async (req, res) => {
  const [fx, featured] = await Promise.all([
    facets(req.company.id),
    searchProperties(req.company.id, parseFilters({ per: 6, availability: 'open' })),
  ]);
  publicCache(res);
  res.json({ company: toPublicCompany(req.company), facets: fx, featured: featured.items });
});

router.get('/properties', readLimit, async (req, res) => {
  const f = parseFilters(req.query);
  const result = await searchProperties(req.company.id, f);
  publicCache(res);
  res.json({ ...result, filters: f });
});

router.get('/properties/:id', readLimit, async (req, res) => {
  const p = await getPublicProperty(req.company.id, req.params.id);
  if (!p) return res.status(404).json({ error: 'This property is not listed' });
  const related = await relatedProperties(req.company.id, p);
  publicCache(res);
  res.json({ property: toPublicProperty(p, { full: true }), related });
});

/** Bookable viewing slots for a property (company schedule minus confirmed viewings). */
router.get('/properties/:id/slots', readLimit, async (req, res) => {
  const p = await getPublicProperty(req.company.id, req.params.id);
  if (!p) return res.status(404).json({ error: 'This property is not listed' });
  const avail = publicAvailability(p);
  if (!avail.can_book_viewing) return res.json({ slots: [], open: false, reason: `This property is ${avail.label.toLowerCase()}.` });
  const busy = await confirmedFor(req.tdb, p.id);
  noStore(res);
  res.json({ open: true, slots: generateSlots(hoursFor(req.company), { busy }) });
});

async function confirmedFor(tdb, propertyId) {
  const { data } = await tdb.from('viewings').select('starts_at,ends_at')
    .eq('property_id', propertyId).eq('status', 'confirmed').gte('ends_at', new Date().toISOString());
  return data || [];
}

function fail(res, e) {
  if (e instanceof EnquiryError) return res.status(e.status).json({ error: e.message });
  console.error('public route:', e);
  return res.status(500).json({ error: 'Something went wrong. Please try again or contact the agency directly.' });
}

/** Enquiry from the website or a property page → CRM lead + inbox conversation. */
router.post('/enquiries', writeLimit, async (req, res) => {
  noStore(res);
  try {
    const body = req.body || {};
    if (body.website) return res.json({ ok: true, reference: null });     // honeypot field: bots fill it
    const source = body.property_id ? 'property_page' : 'website';
    const r = await submitEnquiry(req.company, body, { kind: 'enquiry', source });
    res.status(r.duplicate ? 200 : 201).json({
      ok: true, duplicate: r.duplicate, reference: r.enquiry.reference,
      message: 'Thank you — your enquiry has been sent to the agency. Keep your reference to check for replies.',
    });
  } catch (e) { fail(res, e); }
});

/**
 * Viewing request. Always created as "requested" — it is NOT booked until staff confirm.
 * The time must be one of the slots currently offered.
 */
router.post('/viewings', writeLimit, async (req, res) => {
  noStore(res);
  try {
    const body = req.body || {};
    if (body.website) return res.json({ ok: true, reference: null });
    const p = await getPublicProperty(req.company.id, body.property_id);
    if (!p) return res.status(404).json({ error: 'This property is no longer listed' });
    const hours = hoursFor(req.company);
    const slot = findSlot(hours, body.starts_at, { busy: await confirmedFor(req.tdb, p.id) });
    if (!slot) return res.status(409).json({ error: 'That time is no longer available. Please choose another slot.' });

    let viewing = null;
    const r = await submitEnquiry(req.company, body, {
      kind: 'viewing', source: 'property_page', requireViewable: true,
      describe: ({ property }) => `Viewing request for "${property.title}" on ${new Date(slot.starts_at).toUTCString().replace(' GMT', '')} (GMT)`,
    });
    if (r.duplicate) {
      const { data } = await req.tdb.from('viewings').select('*').eq('enquiry_id', r.enquiry.id).maybeSingle();
      viewing = data;
    } else {
      const { data, error } = await req.tdb.from('viewings').insert({
        reference: r.enquiry.reference, property_id: p.id, lead_id: r.lead.id, enquiry_id: r.enquiry.id,
        agent_id: r.lead.owner_id || null, starts_at: slot.starts_at, ends_at: slot.ends_at, status: 'requested',
        contact_name: r.enquiry.name, contact_phone: r.enquiry.phone, contact_email: r.enquiry.email,
        customer_note: r.enquiry.message,
      }).select().single();
      if (error) throw error;
      viewing = data;
      await audit(null, 'viewing_requested', 'viewing', viewing.id, { reference: viewing.reference, property: p.title, starts_at: slot.starts_at }, req.company.id);
    }
    res.status(r.duplicate ? 200 : 201).json({
      ok: true, duplicate: r.duplicate, reference: r.enquiry.reference,
      viewing: viewing ? toPublicViewing(viewing, { property: p }) : null,
      message: 'Request received. This viewing is not yet confirmed — the agency will confirm the time.',
    });
  } catch (e) { fail(res, e); }
});

/** Load a request by reference, but only for someone who knows the phone/email used. */
async function verifiedEnquiry(req, res) {
  const reference = String(req.body?.reference || req.params.reference || '').trim().toUpperCase();
  const contact = String(req.body?.contact || '').trim();
  if (!/^BA-[A-Z0-9]{8}$/.test(reference) || !contact) {
    res.status(400).json({ error: 'Enter your reference (e.g. BA-7K3M9QX2) and the phone or email you used.' });
    return null;
  }
  const { data: e } = await req.tdb.from('enquiries').select('*').eq('reference', reference).maybeSingle();
  // same message whether the reference or the contact is wrong — no probing which one exists
  if (!e || !contactMatches(contact, { phone: e.phone, email: e.email })) {
    res.status(404).json({ error: 'We could not find a request with those details.' });
    return null;
  }
  return e;
}

/** Customer status page: enquiry + its viewings + replies from the agency. */
router.post('/requests/lookup', lookupLimit, async (req, res) => {
  noStore(res);
  const e = await verifiedEnquiry(req, res);
  if (!e) return;
  const [{ data: views }, { data: prop }] = await Promise.all([
    req.tdb.from('viewings').select('*').eq('enquiry_id', e.id).order('starts_at'),
    e.property_id ? req.tdb.from('properties').select('id,title,listing_status,archived_at').eq('id', e.property_id).maybeSingle() : { data: null },
  ]);
  const agentIds = [...new Set((views || []).map((v) => v.agent_id).filter(Boolean))];
  const { data: agents } = agentIds.length ? await req.tdb.from('users').select('id,name').in('id', agentIds) : { data: [] };
  const agentName = (id) => (agents || []).find((a) => a.id === id)?.name?.split(' ')[0] || null;
  let messages = [];
  if (e.conversation_id) {
    const { data: m } = await req.tdb.child('messages').select('direction,body,sender_type,created_at')
      .eq('conversation_id', e.conversation_id).eq('is_draft', false).gte('created_at', e.created_at).order('created_at').limit(100);
    messages = (m || []).map((x) => ({ from: x.direction === 'in' ? 'you' : x.sender_type === 'ai' ? 'assistant' : 'agency', body: x.body, at: x.created_at }));
  }
  const property = prop && isPublic(prop) ? prop : prop ? { id: null, title: prop.title } : null;
  const hours = hoursFor(req.company);
  res.json({
    enquiry: toPublicEnquiry(e, property),
    viewings: (views || []).map((v) => ({
      ...toPublicViewing(v, { property, agentName: agentName(v.agent_id) }),
      can_change: ['requested', 'confirmed'].includes(v.status) && withinCustomerCutoff(hours, v.starts_at),
    })),
    messages,
  });
});

/** Customer cancels their own viewing (policy: before the company's cut-off). */
router.post('/requests/:reference/viewings/:viewingId/cancel', lookupLimit, async (req, res) => {
  noStore(res);
  const e = await verifiedEnquiry(req, res);
  if (!e) return;
  const { data: v } = await req.tdb.from('viewings').select('*').eq('id', req.params.viewingId).eq('enquiry_id', e.id).maybeSingle();
  if (!v) return res.status(404).json({ error: 'Viewing not found' });
  if (!['requested', 'confirmed'].includes(v.status)) return res.status(409).json({ error: 'This viewing can no longer be cancelled.' });
  if (!withinCustomerCutoff(hoursFor(req.company), v.starts_at)) return res.status(409).json({ error: 'It is too close to the viewing time to cancel online — please call the agency.' });
  const { data } = await req.tdb.from('viewings').update({ status: 'cancelled', cancelled_by: 'customer', updated_at: new Date().toISOString() }).eq('id', v.id).select().single();
  await req.tdb.child('messages').insert({ conversation_id: e.conversation_id, direction: 'in', sender_type: 'contact', body: `Customer cancelled viewing ${v.reference} (${new Date(v.starts_at).toUTCString()}).` });
  await req.tdb.from('conversations').update({ unread: true, last_message_at: new Date().toISOString() }).eq('id', e.conversation_id);
  await audit(null, 'viewing_cancelled_by_customer', 'viewing', v.id, { reference: v.reference }, req.company.id);
  res.json({ ok: true, viewing: toPublicViewing(data) });
});

/** Customer asks for a different time → back to "awaiting confirmation". */
router.post('/requests/:reference/viewings/:viewingId/reschedule', lookupLimit, async (req, res) => {
  noStore(res);
  const e = await verifiedEnquiry(req, res);
  if (!e) return;
  const { data: v } = await req.tdb.from('viewings').select('*').eq('id', req.params.viewingId).eq('enquiry_id', e.id).maybeSingle();
  if (!v) return res.status(404).json({ error: 'Viewing not found' });
  if (!['requested', 'confirmed', 'declined'].includes(v.status)) return res.status(409).json({ error: 'This viewing can no longer be changed.' });
  const hours = hoursFor(req.company);
  if (v.status !== 'declined' && !withinCustomerCutoff(hours, v.starts_at)) return res.status(409).json({ error: 'It is too close to the viewing time to change online — please call the agency.' });
  const p = await getPublicProperty(req.company.id, v.property_id);
  if (!p || !publicAvailability(p).can_book_viewing) return res.status(409).json({ error: 'This property is no longer open for viewings.' });
  const busy = (await confirmedFor(req.tdb, v.property_id)).filter((b) => !(v.status === 'confirmed' && overlaps(b.starts_at, b.ends_at, v.starts_at, v.ends_at)));
  const slot = findSlot(hours, req.body?.starts_at, { busy });
  if (!slot) return res.status(409).json({ error: 'That time is not available. Please choose another slot.' });
  const { data } = await req.tdb.from('viewings').update({
    status: 'requested', starts_at: slot.starts_at, ends_at: slot.ends_at, decline_reason: null, updated_at: new Date().toISOString(),
  }).eq('id', v.id).select().single();
  await req.tdb.child('messages').insert({ conversation_id: e.conversation_id, direction: 'in', sender_type: 'contact', body: `Customer asked to move viewing ${v.reference} to ${new Date(slot.starts_at).toUTCString()} — please confirm.` });
  await req.tdb.from('conversations').update({ unread: true, last_message_at: new Date().toISOString() }).eq('id', e.conversation_id);
  await audit(null, 'viewing_reschedule_requested', 'viewing', v.id, { reference: v.reference, starts_at: slot.starts_at }, req.company.id);
  res.json({ ok: true, viewing: toPublicViewing(data, { property: p }) });
});

/** Customer replies on their request thread (lands in the unified inbox). */
router.post('/requests/:reference/messages', writeLimit, async (req, res) => {
  noStore(res);
  const e = await verifiedEnquiry(req, res);
  if (!e) return;
  const body = String(req.body?.body || '').trim().slice(0, 2000);
  if (!body) return res.status(400).json({ error: 'Write a message first' });
  await req.tdb.child('messages').insert({ conversation_id: e.conversation_id, direction: 'in', sender_type: 'contact', body });
  await req.tdb.from('conversations').update({ unread: true, last_message_at: new Date().toISOString() }).eq('id', e.conversation_id);
  res.json({ ok: true });
});

/** AI property assistant — read-only over published listings; never writes records. */
router.post('/assistant', aiLimit, async (req, res) => {
  noStore(res);
  try {
    const messages = Array.isArray(req.body?.messages) ? req.body.messages.slice(-10) : [];
    const clean = messages
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .map((m) => ({ role: m.role, content: m.content.slice(0, 1000) }));
    if (!clean.length || clean[clean.length - 1].role !== 'user') return res.status(400).json({ error: 'Ask a question first' });
    const contextIds = (Array.isArray(req.body?.property_ids) ? req.body.property_ids : []).filter((x) => typeof x === 'string').slice(0, 4);
    res.json(await assistantReply(req.company, clean, { contextIds }));
  } catch (e) { fail(res, e); }
});

router.get('/sitemap', readLimit, async (req, res) => {
  publicCache(res, 300);
  res.json({ items: await sitemapEntries(req.company.id) });
});

export default router;
