import { db } from '../db.js';

/** Is a real delivery provider configured for this channel? (Email has none yet.) */
export function channelConfigured(channel) {
  if (channel === 'whatsapp') return !!(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
  return false;
}

/**
 * Integration seam — every outbound WhatsApp/SMS/email goes through here.
 * With credentials set it sends for real; without, it records to the outbox
 * as 'simulated' so the whole workflow stays functional and inspectable.
 *
 * opts.companyId  — which company the message belongs to (outbox is per company)
 * opts.dedupeKey  — the same key is never sent twice (safe on retries)
 * opts.storeBody  — text the outbox keeps instead of the real body (redaction)
 *
 * Email has no provider wired yet: email rows are always 'simulated'.
 */
export async function sendMessage(channel, toAddr, body, ref = 'reply', opts = {}) {
  // storeBody: what the outbox keeps (e.g. a sign-in code is redacted so staff can't read it)
  const { companyId = null, dedupeKey = null, storeBody = null } = opts;

  if (dedupeKey) {
    const { data: prior } = await db.from('outbox').select('id,status').eq('dedupe_key', dedupeKey).maybeSingle();
    if (prior) return { ...prior, duplicate: true };
  }

  let status = 'simulated';
  if (channel === 'whatsapp' && process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID) {
    try {
      const r = await fetch(
        `https://graph.facebook.com/v19.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: toAddr.replace(/[^0-9]/g, ''),
            type: 'text',
            text: { body },
          }),
        }
      );
      status = r.ok ? 'sent' : 'failed';
    } catch {
      status = 'failed';
    }
  }

  const row = { company_id: companyId, channel, to_addr: toAddr, body: storeBody ?? body, ref, status };
  if (dedupeKey) row.dedupe_key = dedupeKey;
  const { data, error } = await db.from('outbox').insert(row).select().single();
  if (error && error.code === '23505') return { duplicate: true };   // lost a race with an identical send
  return data;
}

/**
 * Payment gateway seam. Real Paystack init when key is set; otherwise a
 * simulated checkout that the portal confirms immediately (demo mode).
 */
export async function initPayment(client, amount, meta = {}) {
  if (process.env.PAYSTACK_SECRET_KEY) {
    // Paystack needs the payer's real email; never substitute a made-up one.
    if (!client.email) return { mode: 'error', error: 'Add an email address to your client record to pay online, or pay by bank/MoMo.' };
    try {
      const r = await fetch('https://api.paystack.co/transaction/initialize', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: client.email,
          amount: Math.round(amount * 100),
          currency: 'GHS',
          metadata: meta,                       // company_id + installment_id, re-checked by the webhook
          ...(process.env.PAYSTACK_CALLBACK_URL ? { callback_url: process.env.PAYSTACK_CALLBACK_URL } : {}),
        }),
        signal: AbortSignal.timeout(15000),
      });
      const j = await r.json();
      if (j.status) return { mode: 'paystack', url: j.data.authorization_url, reference: j.data.reference };
      return { mode: 'error', error: 'The payment provider could not start this payment. Please try again later.' };
    } catch {
      return { mode: 'error', error: 'The payment provider is unreachable. Please try again later.' };
    }
  }
  return { mode: 'simulated', reference: `SIM-${Date.now()}` };
}
