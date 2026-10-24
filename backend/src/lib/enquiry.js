import { tenantDb } from './tenant.js';
import { nextAgent } from './assign.js';
import { draftReply } from './ai.js';
import { audit } from './audit.js';
import { normalizePhone, normalizeEmail, matchLead, makeReference } from './contacts.js';
import { isPublic, publicAvailability } from './listing.js';

/**
 * The single path by which a customer enquiry enters the CRM.
 *
 *   validate → (idempotency replay?) → property belongs to company & is open
 *   → match existing lead (phone/email only) or create one, round-robin assigned
 *   → website conversation in the unified inbox (unread, assigned to the lead owner)
 *   → enquiry record (reference shown to the customer)
 *   → inbound message + AI DRAFT reply (never auto-sent: an agent reviews it)
 *   → audit
 *
 * Supabase has no multi-statement transactions over HTTP, so the steps are ordered
 * so that a failure leaves nothing misleading behind, and a duplicate submission
 * (same idempotency key) is detected and its partial records are cleaned up.
 */

export class EnquiryError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const clip = (v, n) => (v == null ? '' : String(v).trim().slice(0, n));

/** Server-side validation of the customer's contact block. */
export function validateContact(input = {}) {
  const errors = [];
  const name = clip(input.name, 80);
  if (name.length < 2) errors.push('Please enter your name');
  const rawPhone = clip(input.phone, 32);
  const rawEmail = clip(input.email, 254);
  const phone = rawPhone ? normalizePhone(rawPhone) : null;
  const email = rawEmail ? normalizeEmail(rawEmail) : null;
  if (rawPhone && !phone) errors.push('Please enter a valid phone number');
  if (rawEmail && !email) errors.push('Please enter a valid email address');
  if (!phone && !email && !errors.length) errors.push('Please give a phone number or email so the agency can reach you');
  const message = clip(input.message, 2000);
  const idem = input.idempotency_key ? clip(input.idempotency_key, 64) : null;
  if (idem && !/^[\w-]{8,64}$/.test(idem)) errors.push('Invalid request key');
  return { errors, value: { name, phone, email, message, consent: input.consent === true, idempotency_key: idem } };
}

/** Public, customer-safe view of an enquiry. */
export function toPublicEnquiry(e, property) {
  const labels = { new: 'Received', in_progress: 'An agent is handling this', closed: 'Closed' };
  return {
    reference: e.reference,
    kind: e.kind,
    status: e.status,
    status_label: labels[e.status] || 'Received',
    created_at: e.created_at,
    property: property ? { id: property.id, title: property.title } : null,
  };
}

/**
 * Create an enquiry (and optionally attach a viewing via `afterCreate`).
 * Returns { enquiry, lead, conversation, duplicate, property }.
 */
export async function submitEnquiry(company, input, { kind = 'enquiry', source = 'website', requireViewable = false, describe } = {}) {
  const tdb = tenantDb(company.id);
  const { errors, value: v } = validateContact(input);
  if (errors.length) throw new EnquiryError(400, errors.join('. '));

  // replay of an already-processed submission → same answer, nothing new created
  if (v.idempotency_key) {
    const { data: prior } = await tdb.from('enquiries').select('*').eq('idempotency_key', v.idempotency_key).maybeSingle();
    if (prior) return { enquiry: prior, duplicate: true };
  }

  // property must belong to THIS company, be published, and be open for this action
  let property = null;
  if (input.property_id) {
    if (typeof input.property_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(input.property_id)) throw new EnquiryError(400, 'Unknown property');
    const { data } = await tdb.from('properties').select('*').eq('id', input.property_id).maybeSingle();
    if (!isPublic(data)) throw new EnquiryError(404, 'This property is no longer listed');
    const a = publicAvailability(data);
    if (requireViewable ? !a.can_book_viewing : !a.can_enquire) {
      throw new EnquiryError(409, `This property is ${a.label.toLowerCase()} and is not taking new ${requireViewable ? 'viewing requests' : 'enquiries'}`);
    }
    property = data;
  } else if (requireViewable) {
    throw new EnquiryError(400, 'Choose a property to view');
  }

  // ── lead: match or create ──
  const created = { lead: null, conversation: null };
  const match = await matchLead(tdb, { phone: v.phone, email: v.email });
  let lead = match.lead;
  const followUp = new Date(Date.now() + 24 * 3600000).toISOString();
  if (lead) {
    const patch = { updated_at: new Date().toISOString() };
    if (!lead.next_follow_up || new Date(lead.next_follow_up) > new Date(followUp)) patch.next_follow_up = followUp;
    if (!lead.phone && v.phone) patch.phone = v.phone;           // fill blanks, never overwrite
    if (!lead.email && v.email) patch.email = v.email;
    if (!lead.interest && property) patch.interest = property.title;
    const { data } = await tdb.from('leads').update(patch).eq('id', lead.id).select().single();
    lead = data || lead;
  } else {
    const agent = await nextAgent(company.id);
    const note = match.possibleDuplicateOf ? `Possible duplicate of lead ${match.possibleDuplicateOf} (phone/email partly match) — check before merging.` : null;
    const { data, error } = await tdb.from('leads').insert({
      name: v.name, phone: v.phone, email: v.email,
      source: 'Website', stage: 'new', owner_id: agent?.id || null,
      interest: property?.title || null, notes: note, next_follow_up: followUp,
    }).select().single();
    if (error) throw new EnquiryError(500, 'Could not save your enquiry');
    lead = data; created.lead = data;
  }

  // ── website conversation for this lead (agent replies show on the customer's tracking page) ──
  let { data: conv } = await tdb.from('conversations').select('*')
    .eq('lead_id', lead.id).eq('channel', 'webchat').eq('contact_addr', `site:${lead.id}`).maybeSingle();
  if (!conv) {
    const { data, error } = await tdb.from('conversations').insert({
      lead_id: lead.id, channel: 'webchat', contact_name: v.name, contact_addr: `site:${lead.id}`,
      assigned_to: lead.owner_id || null, ai_mode: 'suggest', unread: true,
    }).select().single();
    if (error) { await cleanup(tdb, created); throw new EnquiryError(500, 'Could not save your enquiry'); }
    conv = data; created.conversation = data;
  }

  // ── enquiry record (claims the idempotency key) ──
  const { data: enquiry, error: eErr } = await tdb.from('enquiries').insert({
    reference: makeReference(), property_id: property?.id || null, lead_id: lead.id, conversation_id: conv.id,
    kind, source, name: v.name, phone: v.phone, email: v.email, message: v.message || null,
    contact_consent: v.consent, idempotency_key: v.idempotency_key,
  }).select().single();
  if (eErr) {
    await cleanup(tdb, created);
    if (eErr.code === '23505' && v.idempotency_key) {
      const { data: prior } = await tdb.from('enquiries').select('*').eq('idempotency_key', v.idempotency_key).maybeSingle();
      if (prior) return { enquiry: prior, duplicate: true };
    }
    throw new EnquiryError(500, 'Could not save your enquiry');
  }

  // ── message in the unified inbox + AI draft for the agent ──
  const headline = describe ? describe({ property, enquiry }) : (property ? `Enquiry about "${property.title}"` : 'General enquiry');
  const body = `${headline} · ref ${enquiry.reference}${v.message ? `\n\n${v.message}` : ''}`;
  await tdb.child('messages').insert({ conversation_id: conv.id, direction: 'in', body, sender_type: 'contact' });
  await tdb.from('conversations').update({ unread: true, last_message_at: new Date().toISOString(), contact_name: v.name }).eq('id', conv.id);
  try {
    const ai = await draftReply({ companyId: company.id, contactName: v.name, channel: 'webchat', history: [], incoming: body });
    await tdb.child('messages').insert({ conversation_id: conv.id, direction: 'out', body: ai.text, sender_type: 'ai', is_draft: true, kb_source: ai.kbSource });
  } catch (e) {
    console.error('enquiry AI draft failed:', e.message);   // the enquiry itself is already safe
  }

  await audit(null, 'website_enquiry', 'enquiry', enquiry.id, {
    reference: enquiry.reference, kind, source, property: property?.title || null,
    lead_matched: match.matchedOn || 'new', lead_id: lead.id,
  }, company.id);

  return { enquiry, lead, conversation: conv, property, duplicate: false };
}

async function cleanup(tdb, created) {
  try {
    if (created.conversation) await tdb.from('conversations').delete().eq('id', created.conversation.id);
    if (created.lead) await tdb.from('leads').delete().eq('id', created.lead.id);
  } catch (e) { console.error('enquiry cleanup failed:', e.message); }
}
