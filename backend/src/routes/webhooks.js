import { Router } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { db } from '../db.js';
import { handleInbound } from '../lib/inbound.js';
import { companyBySlug } from '../lib/tenant.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { validPaystackSignature, settlePaystackCharge } from '../lib/payments.js';

const router = Router();

/** Meta webhook verification (WhatsApp). */
router.get('/whatsapp', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  const expected = process.env.WHATSAPP_VERIFY_TOKEN;
  if (mode === 'subscribe' && expected && token === expected) {
    return res.status(200).send(String(challenge));
  }
  res.sendStatus(403);
});

/** X-Hub-Signature-256 check — enforced when WHATSAPP_APP_SECRET is set. */
function validSignature(req) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) return true;
  const sig = req.get('x-hub-signature-256') || '';
  if (!req.rawBody || !sig.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', secret).update(req.rawBody).digest('hex');
  const a = Buffer.from(sig.slice(7)); const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Which company owns this WhatsApp number? Matched on the receiving phone_number_id.
 * Fallback for single-number setups: DEFAULT_COMPANY_SLUG, else the only company.
 */
async function companyForWhatsApp(phoneNumberId) {
  if (phoneNumberId) {
    const { data } = await db.from('companies').select('id').eq('whatsapp_phone_number_id', phoneNumberId).maybeSingle();
    if (data) return data.id;
  }
  if (process.env.DEFAULT_COMPANY_SLUG) {
    const { data } = await db.from('companies').select('id').eq('slug', process.env.DEFAULT_COMPANY_SLUG).maybeSingle();
    if (data) return data.id;
  }
  const { data: all } = await db.from('companies').select('id').limit(2);
  return all?.length === 1 ? all[0].id : null;
}

/** WhatsApp inbound → shared inbound pipeline (lead + conversation + AI). */
router.post('/whatsapp', async (req, res) => {
  if (!validSignature(req)) return res.sendStatus(401);
  res.sendStatus(200); // ack fast; Meta retries otherwise
  try {
    const entry = req.body?.entry?.[0]?.changes?.[0]?.value;
    const msg = entry?.messages?.[0];
    if (!msg || msg.type !== 'text') return;
    const companyId = await companyForWhatsApp(entry?.metadata?.phone_number_id);
    if (!companyId) { console.error('whatsapp webhook: no company mapped to this number'); return; }
    const name = entry?.contacts?.[0]?.profile?.name;
    await handleInbound({ companyId, channel: 'whatsapp', fromAddr: msg.from, fromName: name, body: String(msg.text.body).slice(0, 4000) });
  } catch (e) {
    console.error('whatsapp webhook:', e.message);
  }
});

/**
 * Paystack webhook. Set this URL in the Paystack dashboard:
 *   https://<backend>/api/webhooks/paystack
 * Signature checked first; the transaction is then re-verified with Paystack's API.
 */
router.post('/paystack', async (req, res) => {
  if (!validPaystackSignature(req.rawBody, req.get('x-paystack-signature'))) return res.sendStatus(401);
  const event = req.body?.event;
  if (event !== 'charge.success') return res.sendStatus(200);       // other events are acknowledged and ignored
  const result = await settlePaystackCharge(req.body?.data?.reference);
  if (!result.ok) console.error('paystack webhook not settled:', result.reason);
  res.sendStatus(200);
});

/**
 * Public website chat endpoint (no auth). The company is resolved from the
 * slug server-side; visitor ids are namespaced per company.
 */
router.post('/webchat', rateLimit({ name: 'webchat', windowMs: 60000, max: 20 }), async (req, res) => {
  const { company, visitor_id, name, body } = req.body || {};
  if (!visitor_id || !body) return res.status(400).json({ error: 'visitor_id and body required' });
  const c = await companyBySlug(company);
  if (!c) return res.status(404).json({ error: 'Unknown company' });
  const vid = String(visitor_id).replace(/[^\w-]/g, '').slice(0, 64);
  if (!vid) return res.status(400).json({ error: 'Invalid visitor_id' });
  const result = await handleInbound({
    companyId: c.id, channel: 'webchat', fromAddr: `web:${vid}`,
    fromName: String(name || 'Website visitor').slice(0, 80), body: String(body).slice(0, 2000),
  });
  res.json({ ok: true, aiAction: result.aiAction });
});

export default router;
