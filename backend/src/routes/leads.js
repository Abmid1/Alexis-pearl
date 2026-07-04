import { Router } from 'express';
import { db } from '../db.js';
import { auth, roles, STAFF, MANAGERS } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { nextAgent } from '../lib/assign.js';

const router = Router();
router.use(auth, roles(...STAFF));

const STAGES = ['new', 'contacted', 'viewing', 'closing'];

/** 1b — pipeline. Agents see own leads only; owner/admin/marketing see all. */
router.get('/', async (req, res) => {
  let q = db.from('leads')
    .select('*, owner:owner_id(id,name), campaign:campaign_id(name,platform)')
    .order('created_at', { ascending: false });
  if (req.user.role === 'agent') q = q.eq('owner_id', req.user.id);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  const now = Date.now();
  res.json((data || []).map((l) => ({ ...l, overdue: l.next_follow_up && new Date(l.next_follow_up).getTime() < now && !['won', 'lost'].includes(l.stage) })));
});

/** Path B — manual entry: name + source minimum; auto-assigned round-robin. */
router.post('/', async (req, res) => {
  const { name, source, phone, email, interest, budget, notes } = req.body || {};
  if (!name || !source) return res.status(400).json({ error: 'name and source are required' });
  const agent = await nextAgent();
  const { data, error } = await db.from('leads').insert({
    name, source, phone: phone || null, email: email || null,
    interest: interest || null, budget: budget || 0, notes: notes || null,
    owner_id: agent.id,
    next_follow_up: new Date(Date.now() + 24 * 3600000).toISOString(), // first touch within 24h
  }).select('*, owner:owner_id(id,name)').single();
  if (error) return res.status(500).json({ error: error.message });
  await audit(req.user, 'created', 'lead', data.id, { name, source, assigned_to: agent.name });
  res.json(data);
});

/** Move stage / edit / snooze follow-up. Agents can only touch their own. */
router.patch('/:id', async (req, res) => {
  const { data: lead } = await db.from('leads').select('id,owner_id,stage,name').eq('id', req.params.id).single();
  if (!lead) return res.status(404).json({ error: 'Lead not found' });
  if (req.user.role === 'agent' && lead.owner_id !== req.user.id) return res.status(403).json({ error: 'Not your lead' });

  const allowed = ['stage', 'name', 'phone', 'email', 'interest', 'budget', 'notes', 'next_follow_up', 'owner_id', 'client_id'];
  const patch = {};
  for (const k of allowed) if (k in req.body) patch[k] = req.body[k];
  if (patch.stage && ![...STAGES, 'won', 'lost'].includes(patch.stage)) return res.status(400).json({ error: 'Bad stage' });
  if (patch.owner_id && !MANAGERS.includes(req.user.role)) delete patch.owner_id; // only managers reassign
  patch.updated_at = new Date().toISOString();

  // moving stage resets the follow-up timer (next touch due in 48h)
  if (patch.stage && patch.stage !== lead.stage && !patch.next_follow_up && !['won', 'lost'].includes(patch.stage)) {
    patch.next_follow_up = new Date(Date.now() + 48 * 3600000).toISOString();
  }

  const { data, error } = await db.from('leads').update(patch).eq('id', req.params.id).select('*, owner:owner_id(id,name)').single();
  if (error) return res.status(500).json({ error: error.message });
  await audit(req.user, 'updated', 'lead', lead.id, { name: lead.name, changes: Object.keys(patch) });
  res.json(data);
});

/** Mark follow-up done → clears red, schedules next one. */
router.post('/:id/followed-up', async (req, res) => {
  const days = Number(req.body?.next_in_days ?? 3);
  const { data, error } = await db.from('leads')
    .update({ next_follow_up: new Date(Date.now() + days * 86400000).toISOString(), updated_at: new Date().toISOString() })
    .eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  await audit(req.user, 'followed_up', 'lead', req.params.id, { next_in_days: days });
  res.json(data);
});

export default router;
