import { Router } from 'express';
import { auth, roles } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { initPayment } from '../lib/integrations.js';
import { handleInbound } from '../lib/inbound.js';

const router = Router();
router.use(auth, roles('client'));

/** Resolve the client record for the logged-in portal user. */
async function myClient(req, res) {
  const { data } = await req.tdb.from('clients').select('*').eq('user_id', req.user.id).single();
  if (!data) { res.status(404).json({ error: 'No client record linked to this login' }); return null; }
  return data;
}

/** 1k — the client sees only their own world. */
router.get('/', async (req, res) => {
  const client = await myClient(req, res);
  if (!client) return;

  const [{ data: plans }, { data: docs }, { data: invoices }, { data: units }] = await Promise.all([
    req.tdb.from('payment_plans').select('*, installments(*), unit:unit_id(name,completion_pct,handover_date), deal:deal_id(title)').eq('client_id', client.id),
    req.tdb.from('documents').select('id,title,category,file_url,created_at').eq('client_id', client.id),
    req.tdb.from('invoices').select('*').eq('client_id', client.id),
    req.tdb.from('units').select('*, property:property_id(title,location)').eq('client_id', client.id),
  ]);

  const enriched = (plans || []).map((p) => {
    const inst = (p.installments || []).sort((a, b) => a.seq - b.seq);
    const paid = inst.filter((i) => i.status === 'paid');
    return {
      ...p, installments: inst,
      paidAmount: paid.reduce((s, i) => s + Number(i.amount), 0),
      paidCount: paid.length,
      nextDue: inst.find((i) => i.status !== 'paid') || null,
    };
  });

  res.json({ client: { id: client.id, name: client.name }, plans: enriched, documents: docs || [], invoices: invoices || [], units: units || [] });
});

/** Pay an installment in-app (way 1) — posts automatically on confirm. */
router.post('/pay/:installmentId', async (req, res) => {
  const client = await myClient(req, res);
  if (!client) return;
  const { data: inst } = await req.tdb.child('installments').select('*, plan:plan_id(client_id)').eq('id', req.params.installmentId).single();
  if (!inst || inst.plan?.client_id !== client.id) return res.status(404).json({ error: 'Installment not found' });
  if (inst.status === 'paid') return res.status(400).json({ error: 'Already paid' });

  const gateway = await initPayment(client, Number(inst.amount), { installment_id: inst.id, company_id: req.user.company_id, client_id: client.id });
  if (gateway.mode === 'error') return res.status(502).json({ error: gateway.error });
  // the installment stays unpaid until Paystack's webhook is verified (see lib/payments.js)
  if (gateway.mode === 'paystack') return res.json({ redirect: gateway.url, reference: gateway.reference });

  // simulated gateway (demo only): payment posts immediately. Never in production —
  // there a payment is only marked paid after the provider confirms it server-side.
  if (process.env.NODE_ENV === 'production') return res.status(503).json({ error: 'Online payment is not configured yet. Please pay by bank or MoMo and your agent will record it.' });
  await req.tdb.from('payments').insert({
    plan_id: inst.plan_id, installment_id: inst.id, client_id: client.id,
    amount: inst.amount, method: 'in-app', status: 'approved',
  });
  await req.tdb.child('installments').update({ status: 'paid', paid_at: new Date().toISOString() }).eq('id', inst.id);
  await audit({ id: null, name: client.name, company_id: req.user.company_id }, 'paid_in_app', 'installment', inst.id, { amount: inst.amount, mode: 'simulated' });
  res.json({ ok: true, paid: true });
});

/** Chat with your agent — feeds straight into the unified inbox (1d). */
router.post('/chat', async (req, res) => {
  const client = await myClient(req, res);
  if (!client) return;
  const { body } = req.body || {};
  if (!body?.trim()) return res.status(400).json({ error: 'body required' });
  const result = await handleInbound({
    companyId: req.user.company_id,
    channel: 'webchat',
    fromAddr: client.phone || `portal:${client.id}`,
    fromName: client.name,
    body: body.trim(),
  });
  // link conversation to the client record for portal thread retrieval
  await req.tdb.from('conversations').update({ client_id: client.id }).eq('id', result.conversation.id);
  res.json({ ok: true, aiAction: result.aiAction });
});

/** The client's own chat thread. */
router.get('/chat', async (req, res) => {
  const client = await myClient(req, res);
  if (!client) return;
  const { data: conv } = await req.tdb.from('conversations').select('id').eq('client_id', client.id).eq('channel', 'webchat').maybeSingle();
  if (!conv) return res.json({ messages: [] });
  const { data: messages } = await req.tdb.child('messages').select('direction,body,sender_type,created_at').eq('conversation_id', conv.id).eq('is_draft', false).order('created_at');
  res.json({ messages: messages || [] });
});

export default router;
