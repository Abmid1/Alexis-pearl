import jwt from 'jsonwebtoken';
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { tenantDb } from './tenant.js';
import { normalizePhone, normalizeEmail, phoneVariants, likeExact } from './contacts.js';
import { sendMessage, channelConfigured } from './integrations.js';
import { audit } from './audit.js';

/**
 * Customer sign-in for the public agency website — passwordless one-time codes.
 *
 * Why codes and not passwords: customers sign in rarely, often on a phone from a
 * WhatsApp link. A code sent to the phone/email they gave the agency proves they own
 * it, needs no password reset flow, and lines up with how enquiries are matched.
 *
 * Rules: 6 digits, stored only as a hash, 10-minute expiry, 5 wrong tries max,
 * 3 codes per contact per 15 minutes, new code cancels older ones. Sessions are
 * signed tokens scoped to ONE company and marked "customer" so staff routes refuse them.
 */

const SECRET = () => process.env.JWT_SECRET || 'dev_secret';
const CODE_TTL_MIN = 10;
const MAX_ATTEMPTS = 5;
const MAX_PER_WINDOW = 3;
export const SESSION_DAYS = 7;

export class AuthError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/** Phone or email → { destination, channel, kind } */
export function parseContact(raw) {
  const s = String(raw || '').trim();
  if (s.includes('@')) {
    const e = normalizeEmail(s);
    if (!e) throw new AuthError(400, 'Enter a valid email address');
    return { destination: e, channel: 'email', kind: 'email' };
  }
  const p = normalizePhone(s);
  if (!p) throw new AuthError(400, 'Enter a valid phone number or email');
  return { destination: p, channel: 'whatsapp', kind: 'phone' };
}

export function maskContact(d) {
  if (d.includes('@')) { const [u, h] = d.split('@'); return `${u[0]}${'•'.repeat(Math.max(2, u.length - 1))}@${h}`; }
  return `${d.slice(0, 4)} •••• ••${d.slice(-2)}`;
}

const hashCode = (companyId, destination, code) =>
  createHash('sha256').update(`${SECRET()}:${companyId}:${destination}:${code}`).digest('hex');

/** Send a sign-in code. Response never reveals whether the contact is known. */
export async function requestCode(company, contact) {
  const { destination, channel } = parseContact(contact);
  if (process.env.NODE_ENV === 'production' && !channelConfigured(channel)) {
    throw new AuthError(503, channel === 'email'
      ? 'Sign-in by email isn\'t available yet. Use your phone number, or check a request with its reference on "My requests".'
      : 'Sign-in codes aren\'t available yet. Check a request with its reference on "My requests", or contact the agency.');
  }
  const tdb = tenantDb(company.id);
  const since = new Date(Date.now() - 15 * 60000).toISOString();
  const { count } = await tdb.from('customer_otps').select('id', { count: 'exact', head: true })
    .eq('destination', destination).gte('created_at', since);
  if ((count || 0) >= MAX_PER_WINDOW) throw new AuthError(429, 'Too many codes requested. Please wait 15 minutes and try again.');

  await tdb.from('customer_otps').update({ consumed_at: new Date().toISOString() }).eq('destination', destination).is('consumed_at', null);
  const code = String(randomInt(0, 1000000)).padStart(6, '0');
  const { data: otp, error } = await tdb.from('customer_otps').insert({
    destination, channel, code_hash: hashCode(company.id, destination, code),
    expires_at: new Date(Date.now() + CODE_TTL_MIN * 60000).toISOString(),
  }).select('id').single();
  if (error) throw new Error(error.message);

  const text = `Your ${company.name} sign-in code is ${code}. It expires in ${CODE_TTL_MIN} minutes. Never share this code.`;
  await sendMessage(channel, destination, text, 'sign-in-code', {
    companyId: company.id, dedupeKey: `otp:${otp.id}`, storeBody: `Your ${company.name} sign-in code is ••••••.`,
  });
  if (process.env.NODE_ENV === 'test') globalThis.__BILT_LAST_OTP__ = code;
  else if (process.env.NODE_ENV !== 'production' && !channelConfigured(channel)) {
    console.log(`[dev] sign-in code for ${destination} at ${company.slug}: ${code}  (no ${channel} provider configured)`);
  }
  return { channel, sent_to: maskContact(destination), expires_in_minutes: CODE_TTL_MIN };
}

/** Check a code; on success find or create the customer's client record and issue a session. */
export async function verifyCode(company, contact, code, { name } = {}) {
  const { destination, kind } = parseContact(contact);
  if (!/^\d{6}$/.test(String(code || '').trim())) throw new AuthError(400, 'Enter the 6-digit code');
  const tdb = tenantDb(company.id);
  const { data: otp } = await tdb.from('customer_otps').select('*')
    .eq('destination', destination).is('consumed_at', null).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (!otp || new Date(otp.expires_at) < new Date()) throw new AuthError(400, 'This code has expired. Request a new one.');
  if (otp.attempts >= MAX_ATTEMPTS) throw new AuthError(429, 'Too many wrong attempts. Request a new code.');
  const a = Buffer.from(otp.code_hash, 'hex');
  const b = Buffer.from(hashCode(company.id, destination, String(code).trim()), 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    await tdb.from('customer_otps').update({ attempts: otp.attempts + 1 }).eq('id', otp.id);
    throw new AuthError(400, otp.attempts + 1 >= MAX_ATTEMPTS ? 'Too many wrong attempts. Request a new code.' : 'That code isn\'t right. Check it and try again.');
  }
  // single use — and make sure two parallel requests can't both use it
  const { data: claimed } = await tdb.from('customer_otps').update({ consumed_at: new Date().toISOString() })
    .eq('id', otp.id).is('consumed_at', null).select('id').maybeSingle();
  if (!claimed) throw new AuthError(400, 'This code has already been used. Request a new one.');

  const client = await findOrCreateClient(tdb, { destination, kind, name });
  await tdb.from('clients').update({ last_login_at: new Date().toISOString() }).eq('id', client.id);
  await audit({ id: null, name: client.name, company_id: company.id }, 'customer_signed_in', 'client', client.id, { via: kind });
  return { token: issueToken(company.id, client.id), client: toCustomer(client) };
}

/**
 * The person just proved they control this phone/email.
 *  1. A client already verified with it → that client.
 *  2. Exactly one staff-created client with that contact (not yet verified) → adopt it.
 *  3. Otherwise a new client record.
 */
async function findOrCreateClient(tdb, { destination, kind, name }) {
  const vcol = kind === 'phone' ? 'verified_phone' : 'verified_email';
  const { data: verified } = await tdb.from('clients').select('*').eq(vcol, destination).maybeSingle();
  if (verified) return verified;
  const q = kind === 'phone'
    ? tdb.from('clients').select('*').in('phone', phoneVariants(destination))
    : tdb.from('clients').select('*').ilike('email', likeExact(destination));
  const { data: candidates } = await q.is(vcol, null).limit(2);
  if (candidates?.length === 1) {
    const { data } = await tdb.from('clients').update({ [vcol]: destination }).eq('id', candidates[0].id).select().single();
    return data;
  }
  const cleanName = String(name || '').trim().slice(0, 80);
  const { data, error } = await tdb.from('clients').insert({
    name: cleanName.length >= 2 ? cleanName : 'Website customer',
    phone: kind === 'phone' ? destination : null, email: kind === 'email' ? destination : null, [vcol]: destination,
  }).select().single();
  if (error) throw new Error(error.message);
  return data;
}

export function issueToken(companyId, clientId) {
  return jwt.sign({ kind: 'customer', client_id: clientId, company_id: companyId }, SECRET(), { expiresIn: `${SESSION_DAYS}d`, audience: 'customer' });
}

/** Customer-safe profile. */
export function toCustomer(c) {
  return {
    id: c.id, name: c.name,
    verified_phone: c.verified_phone || null, verified_email: c.verified_email || null,
    notification_prefs: { whatsapp: true, email: true, ...(c.notification_prefs || {}) },
  };
}

/**
 * Middleware for /api/public/:slug/account/* (after the public router resolved req.company).
 * The session must belong to THIS company; a token from another agency's site is refused.
 */
export async function customerAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Please sign in' });
  let p;
  try { p = jwt.verify(token, SECRET(), { audience: 'customer' }); } catch { return res.status(401).json({ error: 'Your session has expired. Please sign in again.' }); }
  if (p.kind !== 'customer' || p.company_id !== req.company.id) return res.status(401).json({ error: 'Please sign in to this agency' });
  const { data: client } = await req.tdb.from('clients').select('*').eq('id', p.client_id).maybeSingle();
  if (!client) return res.status(401).json({ error: 'Please sign in again' });
  req.client = client;
  next();
}
