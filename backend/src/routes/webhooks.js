import { Router } from 'express';
import { handleInbound } from '../lib/inbound.js';

const router = Router();

/** Meta webhook verification (WhatsApp). */
router.get('/whatsapp', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === (process.env.WHATSAPP_VERIFY_TOKEN || 'alexis_verify')) {
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

/** WhatsApp inbound → shared inbound pipeline (lead + conversation + AI). */
router.post('/whatsapp', async (req, res) => {
  res.sendStatus(200); // ack fast; Meta retries otherwise
  try {
    const entry = req.body?.entry?.[0]?.changes?.[0]?.value;
    const msg = entry?.messages?.[0];
    if (!msg || msg.type !== 'text') return;
    const name = entry?.contacts?.[0]?.profile?.name;
    await handleInbound({ channel: 'whatsapp', fromAddr: msg.from, fromName: name, body: msg.text.body });
  } catch (e) {
    console.error('whatsapp webhook:', e.message);
  }
});

/** Public website chatbot endpoint (no auth — it's the public site). */
router.post('/webchat', async (req, res) => {
  const { visitor_id, name, body } = req.body || {};
  if (!visitor_id || !body) return res.status(400).json({ error: 'visitor_id and body required' });
  const result = await handleInbound({ channel: 'webchat', fromAddr: `web:${visitor_id}`, fromName: name || 'Website visitor', body });
  res.json({ ok: true, aiAction: result.aiAction });
});

export default router;
