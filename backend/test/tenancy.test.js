import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { startServer, client, seed, fake, resetRateLimits } from './helpers/setup.js';

/** 15: a user from company B can never read or change company A's records. */
let srv; let call; let s;
before(async () => { srv = await startServer(); call = client(srv.base); });
after(() => srv.close());
beforeEach(async () => { s = await seed(); resetRateLimits(); });

test('lists only ever contain the caller company', async () => {
  const checks = [
    ['/api/leads', (x) => x.id === s.aLead.id],
    ['/api/marketing/listings', (x) => x.id === s.aEastLegon.id],
    ['/api/inbox', (x) => x.id === s.conv.id],
    ['/api/clients', (x) => x.id === s.aClient.id],
    ['/api/team', (x) => x.id === s.aAgent1.id],
    ['/api/kb', (x) => x.title === 'Internal commission SOP'],
  ];
  for (const [path, isA] of checks) {
    const b = await call('GET', path, { token: s.t.bOwner });
    assert.equal(b.status, 200, path);
    assert.ok(!b.body.some(isA), `${path} leaked company A data to company B`);
    const a = await call('GET', path, { token: s.t.aOwner });
    assert.ok(a.body.some(isA), `${path} should show A its own data`);
  }
  const audit = await call('GET', '/api/audit', { token: s.t.bOwner });
  assert.ok(audit.body.every((r) => r.company_id === s.B.id));
});

test('changing a URL id to another company record fails', async () => {
  const id = s.aLead.id;
  assert.equal((await call('PATCH', `/api/leads/${id}`, { token: s.t.bOwner, body: { stage: 'lost' } })).status, 404);
  assert.equal(fake.tables.leads.find((l) => l.id === id).stage, 'contacted');
  assert.equal((await call('POST', `/api/marketing/listings/${s.aEastLegon.id}/unpublish`, { token: s.t.bOwner })).status, 404);
  assert.equal((await call('PATCH', `/api/marketing/listings/${s.aEastLegon.id}`, { token: s.t.bOwner, body: { price: 1 } })).status, 404);
  assert.equal(fake.tables.properties.find((p) => p.id === s.aEastLegon.id).price, 6000);
  assert.equal((await call('GET', `/api/inbox/${s.conv.id}`, { token: s.t.bOwner })).status, 404);
  assert.equal((await call('POST', `/api/inbox/${s.conv.id}/send`, { token: s.t.bOwner, body: { text: 'hi' } })).status, 404);
  assert.equal((await call('POST', `/api/inbox/${s.conv.id}/drafts/${s.draft.id}/approve`, { token: s.t.bOwner })).status, 404);
  // a B conversation id paired with an A draft id must not delete the A draft either
  const bConv = (await fake.from('conversations').insert({ company_id: s.B.id, channel: 'webchat', contact_addr: 'x' }).select().single()).data;
  await call('DELETE', `/api/inbox/${bConv.id}/drafts/${s.draft.id}`, { token: s.t.bOwner });
  assert.ok(fake.tables.messages.some((m) => m.id === s.draft.id), 'A draft survived');
  assert.equal((await call('POST', `/api/pm/activate/${s.aOsu.id}`, { token: s.t.bOwner })).status, 404);
  assert.equal((await call('DELETE', `/api/kb/${fake.tables.documents[0].id}`, { token: s.t.bOwner })).status, 200);
  assert.ok(fake.tables.documents.some((d) => d.company_id === s.A.id && d.title === 'Rental application requirements'), 'delete was scoped');
});

test('foreign ids smuggled in request bodies are rejected', async () => {
  const deal = await call('POST', '/api/deals', { token: s.t.bOwner, body: { title: 'x', sale_price: 100, property_id: s.aEastLegon.id } });
  assert.equal(deal.status, 400);
  const split = await call('POST', '/api/deals', { token: s.t.bOwner, body: { title: 'x', sale_price: 100, splits: [{ user_id: s.aAgent1.id, pct: 100 }] } });
  assert.equal(split.status, 400);
  assert.equal((await call('PATCH', `/api/leads/${s.bLead.id}`, { token: s.t.bOwner, body: { owner_id: s.aAgent1.id } })).status, 400);
  assert.equal((await call('POST', '/api/units', { token: s.t.bOwner, body: { property_id: s.aEastLegon.id, name: 'U1' } })).status, 400);
  assert.equal((await call('POST', '/api/pm/leases', { token: s.t.bOwner, body: { property_id: s.aEastLegon.id, client_id: s.aClient.id, rent_amount: 1, start_date: '2026-01-01', end_date: '2027-01-01' } })).status, 400);
  // company_id in a body is ignored: the record lands in the caller's company
  const lead = await call('POST', '/api/leads', { token: s.t.bOwner, body: { name: 'Planted', source: 'Walk-in', company_id: s.A.id } });
  assert.equal(fake.tables.leads.find((l) => l.id === lead.body.id).company_id, s.B.id);
});

test('viewings and enquiries are isolated between companies', async () => {
  const v = (await fake.from('viewings').insert({ company_id: s.A.id, reference: 'BA-ZZZZZZZZ', property_id: s.aEastLegon.id, starts_at: '2030-01-01T09:00:00Z', ends_at: '2030-01-01T10:00:00Z', contact_name: 'X' }).select().single()).data;
  for (const [m, p] of [['POST', 'confirm'], ['POST', 'decline'], ['POST', 'cancel'], ['POST', 'reschedule']]) {
    assert.equal((await call(m, `/api/viewings/${v.id}/${p}`, { token: s.t.bOwner, body: {} })).status, 404, p);
  }
  assert.equal((await call('PATCH', `/api/viewings/${v.id}`, { token: s.t.bOwner, body: { staff_note: 'x' } })).status, 404);
  assert.equal(fake.tables.viewings[0].status, 'requested');
});

test('agents only see their own work', async () => {
  const mine = await call('GET', '/api/leads', { token: s.t.aAgent2 });
  assert.ok(!mine.body.some((l) => l.id === s.aLead.id), 'agent 2 does not see agent 1 lead');
  assert.equal((await call('PATCH', `/api/leads/${s.aLead.id}`, { token: s.t.aAgent2, body: { stage: 'lost' } })).status, 403);
  const v = (await fake.from('viewings').insert({ company_id: s.A.id, reference: 'BA-YYYYYYYY', property_id: s.aEastLegon.id, lead_id: s.aLead.id, agent_id: s.aAgent1.id, starts_at: '2030-01-01T09:00:00Z', ends_at: '2030-01-01T10:00:00Z', contact_name: 'X' }).select().single()).data;
  assert.ok(!(await call('GET', '/api/viewings', { token: s.t.aAgent2 })).body.some((x) => x.id === v.id));
  assert.equal((await call('POST', `/api/viewings/${v.id}/confirm`, { token: s.t.aAgent2 })).status, 404);
  assert.ok((await call('GET', '/api/viewings', { token: s.t.aAgent1 })).body.some((x) => x.id === v.id));
});

test('sessions: old tokens without a company, forged tokens and missing tokens are refused', async () => {
  const old = jwt.sign({ id: s.aOwner.id, role: 'owner', name: 'x' }, process.env.JWT_SECRET);
  assert.equal((await call('GET', '/api/leads', { token: old })).status, 401);
  const forged = jwt.sign({ id: s.bOwner.id, role: 'owner', company_id: s.A.id }, 'wrong-secret');
  assert.equal((await call('GET', '/api/leads', { token: forged })).status, 401);
  assert.equal((await call('GET', '/api/leads')).status, 401);
  assert.equal((await call('GET', '/api/viewings', { token: 'garbage' })).status, 401);
});

test('company settings: only managers edit, only their own company, inputs validated', async () => {
  assert.equal((await call('PATCH', '/api/company', { token: s.t.aAgent1, body: { name: 'Hacked' } })).status, 403);
  assert.equal((await call('PATCH', '/api/company', { token: s.t.bOwner, body: { tagline: 'Sunrise tagline' } })).status, 200);
  assert.equal(fake.tables.companies.find((c) => c.id === s.A.id).tagline, undefined);
  assert.equal((await call('PATCH', '/api/company', { token: s.t.aOwner, body: { brand_color: 'red' } })).status, 400);
  assert.equal((await call('PATCH', '/api/company', { token: s.t.aOwner, body: { logo_url: 'javascript:alert(1)' } })).status, 400);
  assert.equal((await call('PATCH', '/api/company', { token: s.t.aOwner, body: { slug: 'sunrise-homes' } })).status, 409);
  assert.equal((await call('PATCH', '/api/company', { token: s.t.aOwner, body: { slug: 'admin' } })).status, 400);
  const ok = await call('PATCH', '/api/company', { token: s.t.aOwner, body: { tagline: 'Homes in Accra', services: ['buy', 'rent', 'teleport'], viewing_hours: { days: [1, 2], start: '10:00', end: '15:00', slot_minutes: 30 } } });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.services, ['buy', 'rent']);
  assert.equal(ok.body.settings, undefined);
  assert.equal((await call('GET', '/api/public/alexis-pearl')).body.company.tagline, 'Homes in Accra');
});

test('inbound WhatsApp is routed to the company that owns the receiving number', async () => {
  const payload = (pnid) => ({ entry: [{ changes: [{ value: { metadata: { phone_number_id: pnid }, contacts: [{ profile: { name: 'Yaw' } }], messages: [{ from: '233240001111', type: 'text', text: { body: 'Hi, any 2 bed?' } }] } }] }] });
  assert.equal((await call('POST', '/api/webhooks/whatsapp', { body: payload('PNID-A') })).status, 200);
  await new Promise((r) => setTimeout(r, 100));
  const lead = fake.tables.leads.find((l) => l.phone === '233240001111');
  assert.equal(lead.company_id, s.A.id);
  // unknown number with two companies and no default → nothing is captured
  await call('POST', '/api/webhooks/whatsapp', { body: payload('PNID-UNKNOWN') });
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(fake.tables.leads.filter((l) => l.phone === '233240001111').length, 1);
});

test('public website chat requires a known company slug', async () => {
  assert.equal((await call('POST', '/api/webhooks/webchat', { body: { visitor_id: 'v1', body: 'hi' } })).status, 404);
  const ok = await call('POST', '/api/webhooks/webchat', { body: { company: 'sunrise-homes', visitor_id: 'v1', body: 'hi' } });
  assert.equal(ok.status, 200);
  assert.equal(fake.tables.conversations.find((c) => c.contact_addr === 'web:v1').company_id, s.B.id);
});
