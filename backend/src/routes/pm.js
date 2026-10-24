import { Router } from 'express';
import { auth, roles, STAFF, MANAGERS } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { checkRefs } from '../lib/tenant.js';

const router = Router();
router.use(auth, roles(...STAFF));

/** 1j — property management. Dormant until the first managed property is activated. */
router.get('/', async (req, res) => {
  const [{ data: managed }, { data: leases }, { data: tickets }, { data: rentPayments }] = await Promise.all([
    req.tdb.from('properties').select('id,title,location').eq('managed', true),
    req.tdb.from('leases').select('*, property:property_id(title), unit:unit_id(name), client:client_id(id,name,phone)').order('end_date'),
    req.tdb.from('tickets').select('*, property:property_id(title), client:client_id(name), owner:owner_id(id,name)').order('created_at', { ascending: false }),
    req.tdb.from('payments').select('lease_id,amount,created_at').not('lease_id', 'is', null).eq('status', 'approved'),
  ]);

  const now = new Date();
  const rentRoll = (leases || []).map((l) => {
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const paidThisMonth = (rentPayments || [])
      .filter((p) => p.lease_id === l.id && new Date(p.created_at) >= monthStart)
      .reduce((s, p) => s + Number(p.amount), 0);
    const daysToEnd = Math.ceil((new Date(l.end_date) - now) / 86400000);
    return {
      ...l,
      paidThisMonth,
      arrears: paidThisMonth < Number(l.rent_amount) && l.status === 'active',
      renewalAlert: daysToEnd <= 60 && daysToEnd > 0,
      daysToEnd,
    };
  });

  res.json({ active: (managed || []).length > 0, managed: managed || [], rentRoll, tickets: tickets || [] });
});

/** Activate the module on the first managed property. */
router.post('/activate/:propertyId', roles(...MANAGERS), async (req, res) => {
  const { data, error } = await req.tdb.from('properties').update({ managed: true }).eq('id', req.params.propertyId).select().single();
  if (error) return res.status(500).json({ error: error.message });
  await audit(req.user, 'activated_pm', 'property', data.id, { title: data.title });
  res.json(data);
});

router.post('/leases', roles(...MANAGERS), async (req, res) => {
  const { property_id, unit_id, client_id, rent_amount, start_date, end_date } = req.body || {};
  if (!property_id || !client_id || !rent_amount || !start_date || !end_date) return res.status(400).json({ error: 'property, client, rent, start and end dates required' });
  if (!(await checkRefs(req, res, { property_id: 'properties', unit_id: 'units', client_id: 'clients' }))) return;
  const { data, error } = await req.tdb.from('leases').insert({ property_id, unit_id: unit_id || null, client_id, rent_amount, start_date, end_date }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  await req.tdb.from('properties').update({ managed: true }).eq('id', property_id);
  await audit(req.user, 'created', 'lease', data.id, { rent_amount });
  res.json(data);
});

/** Record a rent payment against a lease. */
router.post('/leases/:id/record-rent', async (req, res) => {
  const { amount, method } = req.body || {};
  const { data: lease } = await req.tdb.from('leases').select('*').eq('id', req.params.id).single();
  if (!lease) return res.status(404).json({ error: 'Lease not found' });
  const { data, error } = await req.tdb.from('payments').insert({
    lease_id: lease.id, client_id: lease.client_id, amount: amount || lease.rent_amount,
    method: method || 'momo', recorded_by: req.user.id, status: 'approved',
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  await audit(req.user, 'recorded_rent', 'payment', data.id, { lease: lease.id, amount: data.amount });
  res.json(data);
});

/** Maintenance tickets — every request is logged with an owner. */
router.post('/tickets', async (req, res) => {
  const { property_id, unit_id, client_id, title, description } = req.body || {};
  if (!title) return res.status(400).json({ error: 'title required' });
  if (!(await checkRefs(req, res, { property_id: 'properties', unit_id: 'units', client_id: 'clients' }))) return;
  const { data, error } = await req.tdb.from('tickets').insert({
    property_id: property_id || null, unit_id: unit_id || null, client_id: client_id || null,
    title, description: description || null, owner_id: req.user.id,
  }).select('*, owner:owner_id(id,name)').single();
  if (error) return res.status(500).json({ error: error.message });
  await audit(req.user, 'created', 'ticket', data.id, { title });
  res.json(data);
});

router.patch('/tickets/:id', async (req, res) => {
  const patch = {};
  for (const k of ['status', 'owner_id', 'description']) if (k in req.body) patch[k] = req.body[k];
  if (!(await checkRefs(req, res, { owner_id: 'users' }, patch))) return;
  const { data, error } = await req.tdb.from('tickets').update(patch).eq('id', req.params.id).select('*, owner:owner_id(id,name)').single();
  if (error) return res.status(500).json({ error: error.message });
  await audit(req.user, 'updated', 'ticket', data.id, patch);
  res.json(data);
});

export default router;
