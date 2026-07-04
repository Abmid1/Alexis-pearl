import { Router } from 'express';
import { db } from '../db.js';
import { auth, roles, STAFF, MANAGERS } from '../middleware/auth.js';
import bcrypt from 'bcryptjs';
import { audit } from '../lib/audit.js';

const router = Router();
router.use(auth, roles(...STAFF));

/** Audit log — who changed what, when. */
router.get('/audit', roles(...MANAGERS), async (req, res) => {
  const { data } = await db.from('audit_log').select('*').order('created_at', { ascending: false }).limit(200);
  res.json(data || []);
});

/** Outbox — every simulated/sent WhatsApp, SMS, email (integration seam inspector). */
router.get('/outbox', roles(...MANAGERS), async (req, res) => {
  const { data } = await db.from('outbox').select('*').order('created_at', { ascending: false }).limit(100);
  res.json(data || []);
});

/** Clients directory (for pickers) + invite to portal. */
router.get('/clients', async (req, res) => {
  const { data } = await db.from('clients').select('*, user:user_id(email)').order('name');
  res.json(data || []);
});

router.post('/clients', async (req, res) => {
  const { name, phone, email } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });
  const { data, error } = await db.from('clients').insert({ name, phone: phone || null, email: email || null }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  await audit(req.user, 'created', 'client', data.id, { name });
  res.json(data);
});

/** Invite a client to the portal — creates their login. */
router.post('/clients/:id/invite', roles(...MANAGERS), async (req, res) => {
  const { password } = req.body || {};
  const { data: client } = await db.from('clients').select('*').eq('id', req.params.id).single();
  if (!client) return res.status(404).json({ error: 'Client not found' });
  if (client.user_id) return res.status(400).json({ error: 'Client already has portal access' });
  if (!client.email) return res.status(400).json({ error: 'Client needs an email first' });

  const pwd = password || Math.random().toString(36).slice(2, 10);
  const { data: user, error } = await db.from('users').insert({
    name: client.name, email: client.email.toLowerCase(), role: 'client',
    password_hash: await bcrypt.hash(pwd, 10),
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  await db.from('clients').update({ user_id: user.id }).eq('id', client.id);
  await audit(req.user, 'invited_to_portal', 'client', client.id, { email: client.email });
  res.json({ ok: true, email: client.email, password: pwd });
});

/** Team list (for split pickers / reassignment). */
router.get('/team', async (req, res) => {
  const { data } = await db.from('users').select('id,name,role').in('role', ['owner', 'admin', 'agent', 'marketing']).eq('active', true);
  res.json(data || []);
});

/** Units for a property (plan / construction pickers). */
router.get('/units', async (req, res) => {
  const { data } = await db.from('units').select('*, property:property_id(title), client:client_id(name)').order('created_at');
  res.json(data || []);
});

router.post('/units', roles(...MANAGERS), async (req, res) => {
  const { property_id, name, client_id, completion_pct, handover_date } = req.body || {};
  if (!property_id || !name) return res.status(400).json({ error: 'property_id and name required' });
  const { data, error } = await db.from('units').insert({
    property_id, name, client_id: client_id || null,
    completion_pct: completion_pct || 0, handover_date: handover_date || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  await audit(req.user, 'created', 'unit', data.id, { name });
  res.json(data);
});

export default router;
