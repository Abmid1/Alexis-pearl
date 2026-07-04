import { Router } from 'express';
import { db } from '../db.js';
import { auth, roles, STAFF, MANAGERS } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { sendMessage } from '../lib/integrations.js';

const router = Router();
router.use(auth, roles(...STAFF));

const planSelect = '*, client:client_id(id,name,phone), deal:deal_id(id,title), unit:unit_id(id,name,completion_pct,handover_date), installments(*)';

function enrich(p) {
  const inst = (p.installments || []).sort((a, b) => a.seq - b.seq);
  const paid = inst.filter((i) => i.status === 'paid');
  const overdue = inst.filter((i) => i.status !== 'paid' && new Date(i.due_date) < new Date());
  const next = inst.find((i) => i.status !== 'paid');
  return {
    ...p, installments: inst,
    paidAmount: paid.reduce((s, i) => s + Number(i.amount), 0),
    paidCount: paid.length,
    currentInstallment: paid.length + 1,
    nextDue: next || null,
    overdueCount: overdue.length,
  };
}

/** 1g — all plans with progress. Agents see their clients' plans. */
router.get('/', async (req, res) => {
  const { data, error } = await db.from('payment_plans').select(planSelect).order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  let plans = (data || []).map(enrich);
  if (req.user.role === 'agent') {
    const { data: myDeals } = await db.from('deals').select('id').eq('agent_id', req.user.id);
    const mine = new Set((myDeals || []).map((d) => d.id));
    plans = plans.filter((p) => !p.deal_id || mine.has(p.deal_id));
  }
  res.json(plans);
});

/** Create a plan → generates the installment schedule. */
router.post('/', roles(...MANAGERS), async (req, res) => {
  const { deal_id, client_id, unit_id, total, installment_count, start_date } = req.body || {};
  if (!client_id || !total || !installment_count) return res.status(400).json({ error: 'client_id, total, installment_count required' });

  const { data: plan, error } = await db.from('payment_plans').insert({
    deal_id: deal_id || null, client_id, unit_id: unit_id || null,
    total, installment_count, start_date: start_date || new Date().toISOString().slice(0, 10),
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });

  const per = +(total / installment_count).toFixed(2);
  const start = new Date(plan.start_date);
  const rows = Array.from({ length: installment_count }, (_, i) => {
    const d = new Date(start); d.setMonth(d.getMonth() + i);
    return {
      plan_id: plan.id, seq: i + 1, due_date: d.toISOString().slice(0, 10),
      // last installment absorbs rounding so the schedule sums exactly to total
      amount: i === installment_count - 1 ? +(total - per * (installment_count - 1)).toFixed(2) : per,
    };
  });
  await db.from('installments').insert(rows);
  await audit(req.user, 'created', 'payment_plan', plan.id, { total, installment_count });
  const { data: full } = await db.from('payment_plans').select(planSelect).eq('id', plan.id).single();
  res.json(enrich(full));
});

/** Record payment (way 2): bank / MoMo / cash — enters approval queue with receipt. */
router.post('/:id/record-payment', async (req, res) => {
  const { amount, method, receipt_url } = req.body || {};
  if (!amount || !method) return res.status(400).json({ error: 'amount and method required' });
  const { data: plan } = await db.from('payment_plans').select(planSelect).eq('id', req.params.id).single();
  if (!plan) return res.status(404).json({ error: 'Plan not found' });

  const next = (plan.installments || []).sort((a, b) => a.seq - b.seq).find((i) => i.status !== 'paid');
  const { data: payment, error } = await db.from('payments').insert({
    plan_id: plan.id, installment_id: next?.id || null, client_id: plan.client_id,
    amount, method, receipt_url: receipt_url || null,
    recorded_by: req.user.id, status: 'pending_approval',   // manual records need Owner/Admin approval
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  await audit(req.user, 'recorded', 'payment', payment.id, { amount, method, plan: plan.id });
  res.json(payment);
});

/** Construction / completion tracker — feeds the client portal identically. */
router.patch('/units/:unitId', async (req, res) => {
  const patch = {};
  if ('completion_pct' in req.body) patch.completion_pct = Math.max(0, Math.min(100, Number(req.body.completion_pct)));
  if ('handover_date' in req.body) patch.handover_date = req.body.handover_date;
  const { data, error } = await db.from('units').update(patch).eq('id', req.params.unitId).select().single();
  if (error) return res.status(500).json({ error: error.message });
  await audit(req.user, 'updated', 'unit', data.id, patch);
  res.json(data);
});

/** Send WhatsApp reminders now for installments due in the next N days (also runs on cron). */
router.post('/send-reminders', async (req, res) => {
  const days = Number(req.body?.days ?? 3);
  const cutoff = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  const { data: due } = await db.from('installments')
    .select('*, plan:plan_id(client:client_id(name,phone))')
    .eq('status', 'pending').eq('reminder_sent', false).lte('due_date', cutoff);

  let sent = 0;
  for (const i of due || []) {
    const c = i.plan?.client;
    if (!c?.phone) continue;
    await sendMessage('whatsapp', c.phone,
      `Hello ${c.name}, a friendly reminder from Alexis Pearl: your installment of GHS ${Number(i.amount).toLocaleString()} is due on ${i.due_date}. You can pay in the client portal or reply here for help.`,
      'reminder');
    await db.from('installments').update({ reminder_sent: true }).eq('id', i.id);
    sent++;
  }
  await audit(req.user, 'sent_reminders', 'installments', null, { sent });
  res.json({ sent });
});

export default router;
