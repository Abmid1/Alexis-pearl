import { createHmac, timingSafeEqual } from 'node:crypto';
import { db } from '../db.js';
import { audit } from './audit.js';

/**
 * Paystack verification. An installment is marked paid ONLY when:
 *   1. Paystack's webhook signature (HMAC-SHA512 of the raw body with our secret key) is valid, and
 *   2. we re-fetch the transaction from Paystack's API and it says success, in GHS, and
 *   3. the amount equals the installment amount, and the metadata's company/installment match our records.
 * Each Paystack reference is recorded once (unique index), so retried webhooks do nothing.
 */

export function validPaystackSignature(rawBody, signature) {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key || !rawBody || typeof signature !== 'string') return false;
  const expected = createHmac('sha512', key).update(rawBody).digest('hex');
  const a = Buffer.from(signature); const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function fetchTransaction(reference) {
  const r = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
    signal: AbortSignal.timeout(15000),
  });
  const j = await r.json().catch(() => ({}));
  return r.ok && j.status ? j.data : null;
}

/** Returns { ok, reason } — never throws on bad input. */
export async function settlePaystackCharge(reference) {
  if (typeof reference !== 'string' || !/^[\w.=-]{4,100}$/.test(reference)) return { ok: false, reason: 'bad reference' };
  const tx = await fetchTransaction(reference);
  if (!tx) return { ok: false, reason: 'transaction not found at Paystack' };
  if (tx.status !== 'success') return { ok: false, reason: `transaction status ${tx.status}` };
  if (tx.currency !== 'GHS') return { ok: false, reason: 'unexpected currency' };
  const meta = tx.metadata || {};
  const { data: inst } = await db.from('installments').select('*, plan:plan_id(id,company_id,client_id)').eq('id', String(meta.installment_id || '')).maybeSingle();
  if (!inst || !inst.plan) return { ok: false, reason: 'unknown installment' };
  if (inst.plan.company_id !== meta.company_id) return { ok: false, reason: 'company mismatch' };
  if (Math.round(Number(inst.amount) * 100) !== Number(tx.amount)) return { ok: false, reason: 'amount mismatch' };

  const { error } = await db.from('payments').insert({
    company_id: inst.plan.company_id, plan_id: inst.plan.id, installment_id: inst.id, client_id: inst.plan.client_id,
    amount: inst.amount, method: 'in-app', status: 'approved', provider: 'paystack', provider_reference: reference,
  });
  if (error?.code === '23505') return { ok: true, duplicate: true };
  if (error) return { ok: false, reason: error.message };
  if (inst.status !== 'paid') await db.from('installments').update({ status: 'paid', paid_at: new Date().toISOString() }).eq('id', inst.id);
  await audit(null, 'paid_in_app', 'installment', inst.id, { amount: inst.amount, provider: 'paystack', reference }, inst.plan.company_id);
  return { ok: true };
}
