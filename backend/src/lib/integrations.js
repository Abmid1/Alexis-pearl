import { db } from '../db.js';

/**
 * Integration seam — every outbound WhatsApp/SMS/email goes through here.
 * With credentials set it sends for real; without, it records to the outbox
 * as 'simulated' so the whole workflow stays functional and inspectable.
 */
export async function sendMessage(channel, toAddr, body, ref = 'reply') {
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

  const { data } = await db
    .from('outbox')
    .insert({ channel, to_addr: toAddr, body, ref, status })
    .select()
    .single();
  return data;
}

/**
 * Payment gateway seam. Real Paystack init when key is set; otherwise a
 * simulated checkout that the portal confirms immediately (demo mode).
 */
export async function initPayment(client, amount, meta = {}) {
  if (process.env.PAYSTACK_SECRET_KEY) {
    const r = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: client.email || 'client@alexispearl.com',
        amount: Math.round(amount * 100),
        currency: 'GHS',
        metadata: meta,
      }),
    });
    const j = await r.json();
    if (j.status) return { mode: 'paystack', url: j.data.authorization_url, reference: j.data.reference };
  }
  return { mode: 'simulated', reference: `SIM-${Date.now()}` };
}
