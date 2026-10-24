import { db } from '../db.js';
import { sendMessage } from './integrations.js';

/** Customer-facing labels and "what happens next" — no internal CRM wording. */
export const VIEWING_STATUS = {
  requested: { label: 'Awaiting confirmation', next: 'The agency will confirm this time or suggest another. It is not booked until confirmed.' },
  confirmed: { label: 'Confirmed', next: 'Your viewing is booked. Please arrive on time and bring a valid ID.' },
  declined: { label: 'Not available', next: 'The agency could not offer this time. You can request another slot.' },
  cancelled: { label: 'Cancelled', next: 'This viewing will not take place. You can request a new time at any point.' },
  completed: { label: 'Completed', next: 'Thanks for visiting. Contact the agency if you would like to proceed.' },
  no_show: { label: 'Missed', next: 'This viewing was missed. You can request a new time.' },
};

/** Whitelisted public view: never includes staff_note, outcome or agent internals. */
export function toPublicViewing(v, { property, agentName } = {}) {
  const s = VIEWING_STATUS[v.status] || VIEWING_STATUS.requested;
  return {
    id: v.id,
    reference: v.reference,
    status: v.status,
    status_label: s.label,
    next_step: s.next,
    starts_at: v.starts_at,
    ends_at: v.ends_at,
    decline_reason: v.status === 'declined' ? v.decline_reason || null : null,
    agent_name: v.status === 'confirmed' ? agentName || null : null,
    property: property ? { id: property.id, title: property.title } : null,
    updated_at: v.updated_at,
  };
}

const fmtTime = (iso) => new Date(iso).toLocaleString('en-GB', {
  weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Accra',
});

/**
 * Tell the customer about a viewing status change — only if they consented,
 * only through the existing outbox seam, and never twice for the same event.
 */
export async function notifyViewingChange(companyId, viewing, { consent }) {
  if (!consent) return { sent: false, reason: 'no consent' };
  const { data: company } = await db.from('companies').select('name,slug').eq('id', companyId).single();
  const { data: prop } = await db.from('properties').select('title').eq('id', viewing.property_id).eq('company_id', companyId).single();
  const name = company?.name || 'the agency';
  const what = prop?.title || 'the property';
  const texts = {
    confirmed: `Hello ${viewing.contact_name}, ${name} has confirmed your viewing of ${what} on ${fmtTime(viewing.starts_at)}. Ref ${viewing.reference}.`,
    declined: `Hello ${viewing.contact_name}, ${name} could not offer your requested viewing time for ${what}.${viewing.decline_reason ? ' ' + viewing.decline_reason : ''} You can request another time on our website. Ref ${viewing.reference}.`,
    cancelled: `Hello ${viewing.contact_name}, your viewing of ${what} on ${fmtTime(viewing.starts_at)} has been cancelled by ${name}. Ref ${viewing.reference}.`,
  };
  const text = texts[viewing.status];
  if (!text) return { sent: false, reason: 'no message for this status' };
  const key = `viewing:${viewing.id}:${viewing.status}:${viewing.starts_at}`;
  const results = [];
  if (viewing.contact_phone) results.push(await sendMessage('whatsapp', viewing.contact_phone, text, 'viewing', { companyId, dedupeKey: `${key}:wa` }));
  else if (viewing.contact_email) results.push(await sendMessage('email', viewing.contact_email, text, 'viewing', { companyId, dedupeKey: `${key}:email` }));
  return { sent: results.some((r) => r && !r.duplicate), statuses: results.map((r) => r?.status || (r?.duplicate ? 'duplicate' : 'failed')) };
}
