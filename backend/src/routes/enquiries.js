import { Router } from 'express';
import { auth, roles, STAFF } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';

/** Website enquiries as a list (each one is also a lead + an inbox conversation). */
const router = Router();
router.use(auth, roles(...STAFF));

router.get('/', async (req, res) => {
  let q = req.tdb.from('enquiries')
    .select('*, property:property_id(id,title), lead:lead_id(id,name,stage,owner_id, owner:owner_id(name))')
    .order('created_at', { ascending: false }).limit(200);
  if (req.query.status && req.query.status !== 'all') q = q.eq('status', String(req.query.status));
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  let rows = data || [];
  if (req.user.role === 'agent') rows = rows.filter((e) => e.lead?.owner_id === req.user.id);
  res.json(rows);
});

router.patch('/:id', async (req, res) => {
  const status = req.body?.status;
  if (!['new', 'in_progress', 'closed'].includes(status)) return res.status(400).json({ error: 'Bad status' });
  const { data: e } = await req.tdb.from('enquiries').select('id,reference,lead_id').eq('id', req.params.id).maybeSingle();
  if (!e) return res.status(404).json({ error: 'Enquiry not found' });
  if (req.user.role === 'agent') {
    const { data: lead } = await req.tdb.from('leads').select('owner_id').eq('id', e.lead_id).maybeSingle();
    if (lead?.owner_id !== req.user.id) return res.status(403).json({ error: 'Not your enquiry' });
  }
  const { data } = await req.tdb.from('enquiries').update({ status }).eq('id', e.id).select().single();
  await audit(req.user, 'updated', 'enquiry', e.id, { reference: e.reference, status });
  res.json(data);
});

export default router;
