import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, client, seed, fake, resetRateLimits } from './helpers/setup.js';

/** Existing CRM features keep working after multi-company scoping. */
let srv; let call; let s;
before(async () => { srv = await startServer(); call = client(srv.base); });
after(() => srv.close());
beforeEach(async () => { s = await seed(); resetRateLimits(); });

test('command center loads with website counters', async () => {
  const r = await call('GET', '/api/dashboard', { token: s.t.aOwner });
  assert.equal(r.status, 200);
  assert.ok(r.body.kpis && typeof r.body.brief === 'string');
  assert.ok(r.body.departments.website);
});

test('manual leads are round-robin assigned within the company', async () => {
  const owners = [];
  for (let i = 0; i < 4; i++) {
    const r = await call('POST', '/api/leads', { token: s.t.aOwner, body: { name: `Lead ${i}`, source: 'Walk-in' } });
    assert.equal(r.status, 200);
    owners.push(r.body.owner_id);
  }
  assert.ok(owners.every((o) => [s.aAgent1.id, s.aAgent2.id].includes(o)));
  assert.equal(new Set(owners).size, 2);
  // B has one agent; its cursor is independent
  const b = await call('POST', '/api/leads', { token: s.t.bOwner, body: { name: 'B lead', source: 'Walk-in' } });
  assert.equal(b.body.owner_id, s.bAgent.id);
});

test('deals use the company commission rate and splits', async () => {
  const r = await call('POST', '/api/deals', { token: s.t.bOwner, body: { title: 'Sale', sale_price: 100000, property_id: s.bEastLegon.id } });
  assert.equal(r.status, 200);
  assert.equal(r.body.commission_rate, 4);
  assert.equal(fake.tables.commission_splits.length, 1);
  assert.equal((await call('POST', `/api/deals/${r.body.id}/approve`, { token: s.t.bOwner })).status, 200);
  assert.equal((await call('POST', `/api/deals/${r.body.id}/approve`, { token: s.t.aOwner })).status, 404);
});

test('finance: invoice numbers restart per company; overview sees only own commissions', async () => {
  const a = await call('POST', '/api/finance/invoices', { token: s.t.aOwner, body: { amount: 100 } });
  const b = await call('POST', '/api/finance/invoices', { token: s.t.bOwner, body: { amount: 200 } });
  assert.equal(a.body.number, b.body.number);
  await call('POST', '/api/deals', { token: s.t.aOwner, body: { title: 'A sale', sale_price: 50000 } });
  const ov = await call('GET', '/api/finance', { token: s.t.bOwner });
  assert.equal(ov.status, 200);
  assert.equal(ov.body.commissions.length, 0);
  assert.equal(ov.body.invoices.length, 1);
});

test('payment plans and reminders stay within the company', async () => {
  const plan = await call('POST', '/api/plans', { token: s.t.aOwner, body: { client_id: s.aClient.id, total: 3000, installment_count: 3, start_date: new Date().toISOString().slice(0, 10) } });
  assert.equal(plan.status, 200);
  assert.equal(plan.body.installments.length, 3);
  assert.equal((await call('POST', '/api/plans', { token: s.t.bOwner, body: { client_id: s.aClient.id, total: 1, installment_count: 1 } })).status, 400);
  assert.equal((await call('GET', '/api/plans', { token: s.t.bOwner })).body.length, 0);
  // client has no phone in the seed → nothing sent; B triggering reminders never touches A installments
  await call('POST', '/api/plans/send-reminders', { token: s.t.bOwner, body: { days: 60 } });
  assert.ok(fake.tables.installments.every((i) => !i.reminder_sent));
});

test('inbox simulate + draft approve still work for the owning company', async () => {
  const sim = await call('POST', '/api/inbox/simulate-inbound', { token: s.t.aOwner, body: { from_addr: '+233200000999', from_name: 'Test', body: 'How do payment plans work?' } });
  assert.equal(sim.status, 200);
  assert.equal(fake.tables.leads.find((l) => l.phone === '+233200000999').company_id, s.A.id);
  const ok = await call('POST', `/api/inbox/${s.conv.id}/drafts/${s.draft.id}/approve`, { token: s.t.aOwner, body: { text: 'Hello!' } });
  assert.equal(ok.status, 200);
  assert.equal(fake.tables.outbox.filter((o) => o.ref === 'draft-approved').length, 1);
  // replaying the approval cannot send again
  assert.equal((await call('POST', `/api/inbox/${s.conv.id}/drafts/${s.draft.id}/approve`, { token: s.t.aOwner })).status, 404);
});

test('knowledge base answers from own company docs and never from client contracts', async () => {
  const r = await call('POST', '/api/kb/ask', { token: s.t.bOwner, body: { question: 'rental application requirements' } });
  assert.ok(r.body.sources.every((d) => d.title.startsWith('Sunrise')));
  const a = await call('POST', '/api/kb/ask', { token: s.t.aOwner, body: { question: 'rental application contract' } });
  assert.ok(!a.body.sources.some((d) => d.title.includes('Nana')), 'client contracts are excluded from KB answers');
  const vis = await call('PATCH', `/api/kb/${fake.tables.documents.find((d) => d.client_id).id}/visibility`, { token: s.t.aOwner, body: { is_public: true } });
  assert.equal(vis.status, 400);
});

test('weekly report compiles per company', async () => {
  const r = await call('GET', '/api/reports', { token: s.t.bOwner });
  assert.equal(r.status, 200);
  assert.ok(r.body.leaderboard.every((x) => [s.bOwner.id, s.bAgent.id].includes(x.agentId)));
  const sent = await call('POST', '/api/reports/send-now', { token: s.t.aOwner });
  assert.equal(sent.status, 200);
  assert.equal(fake.tables.report_runs[0].company_id, s.A.id);
});

test('client portal is scoped to the client company', async () => {
  const { signToken } = await import('../src/middleware/auth.js');
  const u = (await fake.from('users').insert({ company_id: s.A.id, name: 'Nana', email: 'nana@a.test', role: 'client', password_hash: 'x' }).select().single()).data;
  fake.tables.clients.find((c) => c.id === s.aClient.id).user_id = u.id;
  const r = await call('GET', '/api/portal', { token: signToken(u) });
  assert.equal(r.status, 200);
  assert.equal(r.body.client.name, 'Nana Adjei');
  assert.equal((await call('GET', '/api/leads', { token: signToken(u) })).status, 403);
});
