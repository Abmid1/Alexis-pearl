import { Router } from 'express';
import { db } from '../db.js';
import { auth, roles, STAFF, MANAGERS } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';

const router = Router();
router.use(auth, roles(...STAFF));

const withSplits = '*, agent:agent_id(id,name), lead:lead_id(id,name), property:property_id(id,title), client:client_id(id,name), splits:commission_splits(id,pct,amount,user:user_id(id,name))';

/** 1c — deals. Agents view own; managers view all + approve. */
router.get('/', async (req, res) => {
  let q = db.from('deals').select(withSplits).order('created_at', { ascending: false });
  if (req.user.role === 'agent') q = q.eq('agent_id', req.user.id);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

/** Create deal — commission auto-computed by the DB (price × rate). */
router.post('/', async (req, res) => {
  const { title, lead_id, client_id, property_id, sale_price, commission_rate, splits } = req.body || {};
  if (!title || !sale_price) return res.status(400).json({ error: 'title and sale_price required' });

  const { data: rateRow } = await db.from('settings').select('value').eq('key', 'commission_rate').single();
  const rate = commission_rate ?? Number(rateRow?.value ?? 5);

  const { data: deal, error } = await db.from('deals').insert({
    title, lead_id: lead_id || null, client_id: client_id || null, property_id: property_id || null,
    agent_id: req.user.id, sale_price, commission_rate: rate, status: 'pending_approval',
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });

  // splits: [{user_id, pct}] — exact GHS per person
  const commission = Number(deal.commission_amount);
  const rows = (splits?.length ? splits : [{ user_id: req.user.id, pct: 100 }])
    .map((s) => ({ deal_id: deal.id, user_id: s.user_id, pct: s.pct, amount: +(commission * s.pct / 100).toFixed(2) }));
  const totalPct = rows.reduce((s, r) => s + Number(r.pct), 0);
  if (Math.round(totalPct) !== 100) return res.status(400).json({ error: `Split must total 100% (got ${totalPct}%)` });
  await db.from('commission_splits').insert(rows);

  await audit(req.user, 'created', 'deal', deal.id, { title, sale_price, commission });
  const { data: full } = await db.from('deals').select(withSplits).eq('id', deal.id).single();
  res.json(full);
});

/** Owner/Admin: approve — the only way a deal closes. */
router.post('/:id/approve', roles(...MANAGERS), async (req, res) => {
  const { data, error } = await db.from('deals')
    .update({ status: 'approved', approved_by: req.user.id, change_note: null })
    .eq('id', req.params.id).select(withSplits).single();
  if (error) return res.status(500).json({ error: error.message });
  // if the deal has a lead, mark it won
  if (data.lead_id) await db.from('leads').update({ stage: 'won', updated_at: new Date().toISOString() }).eq('id', data.lead_id);
  await audit(req.user, 'approved', 'deal', data.id, { title: data.title });
  res.json(data);
});

/** Owner/Admin: request changes with a note. */
router.post('/:id/request-changes', roles(...MANAGERS), async (req, res) => {
  const note = req.body?.note || 'Changes requested';
  const { data, error } = await db.from('deals')
    .update({ status: 'changes_requested', change_note: note })
    .eq('id', req.params.id).select(withSplits).single();
  if (error) return res.status(500).json({ error: error.message });
  await audit(req.user, 'requested_changes', 'deal', data.id, { note });
  res.json(data);
});

/** Agent resubmits after changes. */
router.patch('/:id', async (req, res) => {
  const { data: deal } = await db.from('deals').select('id,agent_id,status').eq('id', req.params.id).single();
  if (!deal) return res.status(404).json({ error: 'Deal not found' });
  if (req.user.role === 'agent' && deal.agent_id !== req.user.id) return res.status(403).json({ error: 'Not your deal' });

  const patch = {};
  for (const k of ['title', 'sale_price', 'commission_rate', 'property_id', 'client_id']) if (k in req.body) patch[k] = req.body[k];
  if (deal.status === 'changes_requested') patch.status = 'pending_approval';

  const { data, error } = await db.from('deals').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });

  // recompute split amounts from the regenerated commission
  const { data: splits } = await db.from('commission_splits').select('id,pct').eq('deal_id', deal.id);
  for (const s of splits || []) {
    await db.from('commission_splits').update({ amount: +(Number(data.commission_amount) * s.pct / 100).toFixed(2) }).eq('id', s.id);
  }
  await audit(req.user, 'updated', 'deal', deal.id, { changes: Object.keys(patch) });
  const { data: full } = await db.from('deals').select(withSplits).eq('id', deal.id).single();
  res.json(full);
});

export default router;
