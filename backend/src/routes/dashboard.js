import { Router } from 'express';
import { auth, roles, MANAGERS, STAFF } from '../middleware/auth.js';
import { dailyBrief } from '../lib/ai.js';
import { db } from '../db.js';

const router = Router();
router.use(auth, roles(...STAFF));

/** 1a — Command Center: KPIs, approvals queue, AI brief, departments at a glance. */
router.get('/', async (req, res) => {
  const now = new Date();
  // installments have no company_id — scope through this company's plans
  const { data: myPlans } = await req.tdb.from('payment_plans').select('id');
  const planIds = (myPlans || []).map((p) => p.id);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const in7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

  const [leadsMonth, activeDeals, paymentsMonth, overdueLeads,
         pendDeals, pendExpenses, pendListings, pendPayments,
         convs, unassigned, invOverdue, upcomingInst, allLeadsMonth, coldLeads, pendingViewings, newEnquiries, company] = await Promise.all([
    req.tdb.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', monthStart),
    req.tdb.from('deals').select('id', { count: 'exact', head: true }).in('status', ['draft', 'pending_approval', 'approved']),
    req.tdb.from('payments').select('amount').eq('status', 'approved').gte('created_at', monthStart),
    req.tdb.from('leads').select('id', { count: 'exact', head: true }).lt('next_follow_up', now.toISOString()).not('stage', 'in', '("won","lost")'),
    req.tdb.from('deals').select('id,title,sale_price,created_at,agent:agent_id(name)').eq('status', 'pending_approval'),
    req.tdb.from('expenses').select('id,amount,category,note,receipt_url,created_at,submitter:submitted_by(name)').eq('status', 'pending'),
    req.tdb.from('properties').select('id,title,price,location,created_at').eq('listing_status', 'pending_approval'),
    req.tdb.from('payments').select('id,amount,method,created_at,client:client_id(name)').eq('status', 'pending_approval'),
    req.tdb.from('conversations').select('id', { count: 'exact', head: true }).eq('unread', true),
    req.tdb.from('conversations').select('id', { count: 'exact', head: true }).is('assigned_to', null),
    req.tdb.from('invoices').select('id', { count: 'exact', head: true }).eq('status', 'overdue'),
    planIds.length
      ? req.tdb.child('installments').select('amount,due_date,plan:plan_id(client:client_id(name))').in('plan_id', planIds).eq('status', 'pending').lte('due_date', in7)
      : Promise.resolve({ data: [] }),
    req.tdb.from('leads').select('source').gte('created_at', monthStart),
    req.tdb.from('leads').select('id,name,updated_at').not('stage', 'in', '("won","lost")').lt('updated_at', new Date(Date.now() - 7 * 86400000).toISOString()),
    req.tdb.from('viewings').select('id', { count: 'exact', head: true }).eq('status', 'requested'),
    req.tdb.from('enquiries').select('id', { count: 'exact', head: true }).eq('status', 'new'),
    db.from('companies').select('name').eq('id', req.user.company_id).single(),
  ]);

  const collected = (paymentsMonth.data || []).reduce((s, p) => s + Number(p.amount), 0);

  // best source this month
  const bySource = {};
  (allLeadsMonth.data || []).forEach((l) => (bySource[l.source] = (bySource[l.source] || 0) + 1));
  const top = Object.entries(bySource).sort((a, b) => b[1] - a[1])[0];

  const approvals = [
    ...(pendDeals.data || []).map((d) => ({ kind: 'deal', id: d.id, label: d.title, detail: `GHS ${Number(d.sale_price).toLocaleString()} · ${d.agent?.name || ''}`, created_at: d.created_at })),
    ...(pendExpenses.data || []).map((e) => ({ kind: 'expense', id: e.id, label: `${e.category} — ${e.note || 'expense'}`, detail: `GHS ${Number(e.amount).toLocaleString()} · ${e.submitter?.name || ''}`, receipt_url: e.receipt_url, created_at: e.created_at })),
    ...(pendListings.data || []).map((p) => ({ kind: 'listing', id: p.id, label: p.title, detail: `GHS ${Number(p.price).toLocaleString()} · ${p.location || ''}`, created_at: p.created_at })),
    ...(pendPayments.data || []).map((p) => ({ kind: 'payment', id: p.id, label: `Payment from ${p.client?.name || 'client'}`, detail: `GHS ${Number(p.amount).toLocaleString()} · ${p.method}`, created_at: p.created_at })),
  ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  const brief = await dailyBrief({
    coldLeads: coldLeads.data || [],
    overdueCount: overdueLeads.count || 0,
    upcoming: (upcomingInst.data || []).map((i) => ({ client: i.plan?.client?.name || 'client', amount: i.amount, due: i.due_date })),
    topSource: top?.[0], topSourceCount: top?.[1],
    pendingApprovals: approvals.length,
    pendingViewings: pendingViewings.count || 0,
  }, company.data?.name);

  res.json({
    kpis: {
      newLeads: leadsMonth.count || 0,
      activeDeals: activeDeals.count || 0,
      collected,
      overdueFollowUps: overdueLeads.count || 0,
    },
    approvals: MANAGERS.includes(req.user.role) ? approvals : [],
    brief,
    departments: {
      sales:   { alert: overdueLeads.count || 0, note: 'overdue follow-ups' },
      inbox:   { alert: (convs.count || 0) + (unassigned.count || 0), note: `${convs.count || 0} unread · ${unassigned.count || 0} unassigned` },
      finance: { alert: (pendExpenses.data?.length || 0) + (invOverdue.count || 0), note: `${pendExpenses.data?.length || 0} pending · ${invOverdue.count || 0} overdue inv.` },
      marketing: { alert: pendListings.data?.length || 0, note: 'listings awaiting approval' },
      website: { alert: (pendingViewings.count || 0) + (newEnquiries.count || 0), note: `${pendingViewings.count || 0} viewing requests · ${newEnquiries.count || 0} new enquiries` },
    },
  });
});

export default router;
