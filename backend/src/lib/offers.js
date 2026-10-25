import { db } from '../db.js';
import { sendMessage } from './integrations.js';

/**
 * Offers recorded by the agency and shown to the customer.
 *
 * An offer here is a record of what the agency has put to the customer, and a
 * customer's acceptance is an indication of intent — it is NOT a signed contract,
 * a reservation, or any transfer of rights. Every customer-facing view says so.
 * Nothing in this module performs conveyancing, escrow or title verification.
 */

export const OFFER_STATUS = {
  draft: { label: 'Draft', next: 'Not yet sent to the customer.' },
  sent: { label: 'Awaiting your response', next: 'Review the terms below and tell the agency if you want to go ahead.' },
  accepted: { label: 'You accepted', next: 'The agency will contact you with the next steps. Nothing is binding until you sign an agreement.' },
  declined: { label: 'You declined', next: 'The agency has been told. You can still ask about other properties.' },
  withdrawn: { label: 'Withdrawn by the agency', next: 'This offer is no longer available. Contact the agency for details.' },
  expired: { label: 'Expired', next: 'This offer passed its response date. Ask the agency if it can be renewed.' },
};

export const DISCLAIMER = 'This is the agency\'s offer as recorded in writing. Accepting it tells the agency you want to proceed. It is not a contract and does not reserve or transfer the property. Nothing is binding until you sign an agreement.';

export const isExpired = (o, now = new Date()) => !!o.expires_at && new Date(o.expires_at) < now && o.status === 'sent';

/** Status as the customer should see it, taking the expiry date into account. */
export const effectiveStatus = (o, now = new Date()) => (isExpired(o, now) ? 'expired' : o.status);

export function toPublicOffer(o, { property, now = new Date() } = {}) {
  const status = effectiveStatus(o, now);
  const s = OFFER_STATUS[status] || OFFER_STATUS.sent;
  return {
    id: o.id, reference: o.reference,
    amount: Number(o.amount), currency: o.currency || 'GHS',
    terms: o.terms || null,
    status, status_label: s.label, next_step: s.next,
    expires_at: o.expires_at || null,
    responded_at: o.responded_at || null,
    can_respond: status === 'sent',
    disclaimer: DISCLAIMER,
    property: property ? { id: property.id, title: property.title } : null,
    created_at: o.created_at, updated_at: o.updated_at,
  };
}

export function validateOffer(body = {}, { partial = false } = {}) {
  const errors = [];
  const patch = {};
  if ('amount' in body || !partial) {
    const n = Number(body.amount);
    if (!Number.isFinite(n) || n < 0 || n > 1e12) errors.push('Enter a valid amount'); else patch.amount = n;
  }
  if ('terms' in body) patch.terms = String(body.terms || '').trim().slice(0, 4000) || null;
  if ('expires_at' in body) {
    if (!body.expires_at) patch.expires_at = null;
    else {
      const d = new Date(body.expires_at);
      if (Number.isNaN(d.getTime())) errors.push('Invalid response date');
      else if (d < new Date()) errors.push('The response date must be in the future');
      else patch.expires_at = d.toISOString();
    }
  }
  return { patch, errors };
}

/** Tell the customer an offer was sent or withdrawn (respects their preferences, never twice). */
export async function notifyOffer(companyId, offer, client) {
  const prefs = { whatsapp: true, email: true, ...(client?.notification_prefs || {}) };
  const { data: company } = await db.from('companies').select('name').eq('id', companyId).single();
  const text = offer.status === 'sent'
    ? `${company?.name || 'Your agency'} has sent you an offer (${offer.reference}) of GHS ${Number(offer.amount).toLocaleString('en-GH')}. Sign in to the agency website to review it.`
    : `${company?.name || 'Your agency'} has withdrawn offer ${offer.reference}. Contact them for details.`;
  if (!['sent', 'withdrawn'].includes(offer.status)) return { sent: false };
  const key = `offer:${offer.id}:${offer.status}:${offer.updated_at}`;
  if (client?.verified_phone && prefs.whatsapp) return { sent: true, r: await sendMessage('whatsapp', client.verified_phone, text, 'offer', { companyId, dedupeKey: `${key}:wa` }) };
  if (client?.verified_email && prefs.email) return { sent: true, r: await sendMessage('email', client.verified_email, text, 'offer', { companyId, dedupeKey: `${key}:email` }) };
  return { sent: false, reason: 'customer opted out or has no verified contact' };
}
