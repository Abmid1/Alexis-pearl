import { randomBytes } from 'node:crypto';

/**
 * Contact normalisation + safe duplicate matching.
 *
 * Rule: people are matched ONLY on a verified-format phone number or email address,
 * never on name. When phone and email point at two different existing leads we do
 * not merge — a new lead is created and staff are told about the possible duplicate.
 */

/** Ghana-aware phone normalisation → E.164 ("+233244000001"), or null if implausible. */
export function normalizePhone(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const plus = s.startsWith('+') || s.startsWith('00');
  let d = s.replace(/\D/g, '');
  if (s.startsWith('00')) d = d.slice(2);
  if (!plus) {
    if (d.length === 10 && d.startsWith('0')) d = '233' + d.slice(1);      // 0244 000 001
    else if (d.length === 9) d = '233' + d;                              // 244 000 001
  }
  if (d.startsWith('2330')) d = '233' + d.slice(4);                      // +233 0244…
  if (d.length < 9 || d.length > 15) return null;
  if (d.startsWith('233') && d.length !== 12) return null;
  return '+' + d;
}

/** The spellings an existing record may have used for the same Ghana number. */
export function phoneVariants(e164) {
  if (!e164) return [];
  const d = e164.replace(/^\+/, '');
  const v = new Set([e164, d]);
  if (d.startsWith('233') && d.length === 12) v.add('0' + d.slice(3));
  return [...v];
}

export function normalizeEmail(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().toLowerCase();
  if (!s) return null;
  return /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[a-z]{2,}$/.test(s) && s.length <= 254 ? s : null;
}

/** Escape LIKE wildcards so an email is matched exactly (case-insensitive). */
export const likeExact = (s) => s.replace(/[\\%_]/g, (c) => '\\' + c);

/** Same person? Compare a submitted contact against stored phone/email. */
export function contactMatches(contact, { phone, email }) {
  const c = String(contact || '').trim();
  if (!c) return false;
  const e = normalizeEmail(c);
  if (e && email && normalizeEmail(email) === e) return true;
  const p = normalizePhone(c);
  if (p && phone && normalizePhone(phone) === p) return true;
  return false;
}

/**
 * Find the existing lead for this person in this company, or decide to create one.
 * Returns { lead, matchedOn, possibleDuplicateOf }.
 */
export async function matchLead(tdb, { phone, email }) {
  const [byPhone, byEmail] = await Promise.all([
    phone ? tdb.from('leads').select('*').in('phone', phoneVariants(phone)).order('created_at').limit(5) : { data: [] },
    email ? tdb.from('leads').select('*').ilike('email', likeExact(email)).order('created_at').limit(5) : { data: [] },
  ]);
  const P = byPhone.data || [];
  const E = byEmail.data || [];
  const both = P.find((l) => E.some((e) => e.id === l.id));
  if (both) return { lead: both, matchedOn: 'phone+email' };
  // a phone match is only trusted if the lead's stored email doesn't contradict the submitted one (and vice versa)
  const p = P.find((l) => !email || !l.email || normalizeEmail(l.email) === email);
  const e = E.find((l) => !phone || !l.phone || normalizePhone(l.phone) === phone);
  if (p && !E.length) return { lead: p, matchedOn: 'phone' };
  if (e && !P.length) return { lead: e, matchedOn: 'email' };
  if (p && e && p.id === e.id) return { lead: p, matchedOn: 'phone+email' };
  // conflicting or ambiguous: don't merge
  const hint = P[0] || E[0];
  return { lead: null, matchedOn: null, possibleDuplicateOf: hint ? hint.id : null };
}

/** Customer-facing reference, e.g. BA-7K3M9QX2 (no 0/O/1/I to avoid misreading). */
export function makeReference(prefix = 'BA') {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(8);
  let out = '';
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return `${prefix}-${out}`;
}
