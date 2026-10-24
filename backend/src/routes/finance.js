import { Router } from 'express';
import { auth, roles, STAFF, MANAGERS } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { checkRefs } from '../lib/tenant.js';

const router = Router();
router.use(auth);

/** 1f — Finance overview. Locked to Owner + Admin (per permission grid). */
router.get('/', roles(...MANAGERS), async (req, res) => {
  // commission_splits have no company_id — scope through this company's deals
  const { data: myDeals } = await req.tdb.from('deals').select('id');
  const dealIds = (myDeals || []).map((d) => d.id);
  const [{ data: invoices }, { data: payments }, { data: expenses }, { data: splits }] = await Promise.all([
    req.tdb.from('invoices').select('*, client:client_id(id,name)').order('created_at', { ascending: false }),
    req.tdb.from('payments').select('*, client:client_id(id,name), recorder:recorded_by(name)').order('created_at', { ascending: false }),
    req.tdb.from('expenses').select('*, submitter:submitted_by(id,name), decider:decided_by(name)').order('created_at', { ascending: false }),
    dealIds.length
      ? req.tdb.child('commission_splits').select('amount, user:user_id(id,name), deal:deal_id(title,status)').in('deal_id', dealIds)
      : Promise.resolve({ data: [] }),
  ]);

  const totalIn = (payments || []).filter((p) => p.status === 'approved').reduce((s, p) => s + Number(p.amount), 0);
  const totalOut = (expenses || []).filter((e) => e.status === 'approved').reduce((s, e) => s + Number(e.amount), 0);
  const commissionOwed = (splits || []).filter((s) => ['approved', 'closed'].includes(s.deal?.status)).reduce((s, r) => s + Number(r.amount), 0);

  res.json({
    kpis: { totalIn, totalOut, commissionOwed, net: totalIn - totalOut },
    invoices: invoices || [], payments: payments || [], expenses: expenses || [],
    commissions: splits || [],
  });
});

/** Invoice generation. Number auto-issued. */
router.post('/invoices', roles(...MANAGERS), async (req, res) => {
  const { client_id, deal_id, amount, due_date, items } = req.body || {};
  if (!amount) return res.status(400).json({ error: 'amount required' });
  if (!(await checkRefs(req, res, { client_id: 'clients', deal_id: 'deals' }))) return;
  const { count } = await req.tdb.from('invoices').select('id', { count: 'exact', head: true });
  const number = `INV-${new Date().getFullYear()}-${String((count || 0) + 1).padStart(4, '0')}`;
  const { data, error } = await req.tdb.from('invoices').insert({
    number, client_id: client_id || null, deal_id: deal_id || null,
    amount, due_date: due_date || null, items: items || [],
  }).select('*, client:client_id(id,name)').single();
  if (error) return res.status(500).json({ error: error.message });
  await audit(req.user, 'created', 'invoice', data.id, { number, amount });
  res.json(data);
});

router.post('/invoices/:id/mark-paid', roles(...MANAGERS), async (req, res) => {
  const { data: inv } = await req.tdb.from('invoices').select('*').eq('id', req.params.id).single();
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  await req.tdb.from('invoices').update({ status: 'paid' }).eq('id', req.params.id);
  await req.tdb.from('payments').insert({
    invoice_id: inv.id, client_id: inv.client_id, amount: inv.amount,
    method: req.body?.method || 'bank', recorded_by: req.user.id, status: 'approved',
  });
  await audit(req.user, 'marked_paid', 'invoice', inv.id, { number: inv.number });
  res.json({ ok: true });
});

/** Expense submission — any staff, mobile-first: amount, category, receipt photo. */
router.post('/expenses', roles(...STAFF), async (req, res) => {
  const { amount, category, note, receipt_url } = req.body || {};
  if (!amount || !category) return res.status(400).json({ error: 'amount and category required' });
  const { data, error } = await req.tdb.from('expenses').insert({
    submitted_by: req.user.id, amount, category, note: note || null, receipt_url: receipt_url || null,
  }).select('*, submitter:submitted_by(id,name)').single();
  if (error) return res.status(500).json({ error: error.message });
  await audit(req.user, 'submitted', 'expense', data.id, { amount, category });
  res.json(data);
});

/** My own expense submissions (staff can track their pending/approved). */
router.get('/expenses/mine', roles(...STAFF), async (req, res) => {
  const { data } = await req.tdb.from('expenses').select('*').eq('submitted_by', req.user.id).order('created_at', { ascending: false });
  res.json(data || []);
});

/** Approve / reject with reason — Owner/Admin, receipt visible in the queue. */
router.post('/expenses/:id/approve', roles(...MANAGERS), async (req, res) => {
  const { data, error } = await req.tdb.from('expenses')
    .update({ status: 'approved', decided_by: req.user.id })
    .eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  await audit(req.user, 'approved', 'expense', data.id, { amount: data.amount, category: data.category });
  res.json(data);
});

router.post('/expenses/:id/reject', roles(...MANAGERS), async (req, res) => {
  const reason = req.body?.reason || 'Rejected';
  const { data, error } = await req.tdb.from('expenses')
    .update({ status: 'rejected', reject_reason: reason, decided_by: req.user.id })
    .eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  await audit(req.user, 'rejected', 'expense', data.id, { reason });
  res.json(data);
});

/** Approve a pending manually-recorded payment. */
router.post('/payments/:id/approve', roles(...MANAGERS), async (req, res) => {
  const { data, error } = await req.tdb.from('payments').update({ status: 'approved' }).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  if (data.installment_id) {
    await req.tdb.child('installments').update({ status: 'paid', paid_at: new Date().toISOString() }).eq('id', data.installment_id);
  }
  await audit(req.user, 'approved', 'payment', data.id, { amount: data.amount });
  res.json(data);
});

export default router;
