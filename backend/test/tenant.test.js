import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, client, seed, fake, resetRateLimits } from './helpers/setup.js';
import { nextRentDue, toPublicLease } from '../src/lib/tenancy.js';

/** Phase 5: existing-tenant portal — rent view + maintenance requests into the CRM. */
let srv; let call; let s;
const ACC = '/api/public/alexis-pearl/account';
const rows = (t) => fake.tables[t] || [];

before(async () => { srv = await startServer(); call = client(srv.base); });
after(() => srv.close());
beforeEach(async () => { s = await seed(); resetRateLimits(); globalThis.__BILT_LAST_OTP__ = null; });

async function signIn(contact, slug = 'alexis-pearl', name = 'Abena Sarpong') {
  await call('POST', `/api/public/${slug}/account/code`, { body: { contact } });
  const v = await call('POST', `/api/public/${slug}/account/verify`, { body: { contact, code: globalThis.__BILT_LAST_OTP__, name } });
  return v.body.token;
}

test('rent due date is anchored to the tenancy start day', () => {
  assert.equal(nextRentDue('2025-06-10', new Date('2026-01-05T00:00:00Z')), '2026-01-10');
  assert.equal(nextRentDue('2025-06-10', new Date('2026-01-20T00:00:00Z')), '2026-02-10');
  assert.equal(nextRentDue('2025-01-31', new Date('2026-02-01T00:00:00Z')), '2026-02-28'); // clamps short months
  const l = toPublicLease({ id: 'x', rent_amount: 4500, status: 'active', start_date: '2025-06-10', end_date: '2030-01-01', property: { title: 'Osu' } },
    { payments: [{ lease_id: 'x', amount: 4500, method: 'momo', created_at: new Date().toISOString() }], now: new Date() });
  assert.equal(l.paid_this_month, 4500);
  assert.equal(l.balance_this_month, 0);
  assert.equal(l.in_arrears, false);
});

test('a signed-in tenant sees only their own lease, rent history and tickets', async () => {
  const token = await signIn('+233204444444');
  const o = await call('GET', `${ACC}/overview`, { token });
  assert.equal(o.body.has_tenancy, true, 'overview flags the tenancy');

  const t = await call('GET', `${ACC}/tenancy`, { token });
  assert.equal(t.status, 200);
  assert.equal(t.body.leases.length, 1);
  const lease = t.body.leases[0];
  assert.equal(lease.property.title, s.aOsu.title);
  assert.equal(lease.rent_amount, 4500);
  assert.equal(lease.status, 'active');
  assert.ok(lease.next_due_date);
  assert.equal(lease.renewal_due, true, 'ends within 60 days');
  assert.equal(t.body.payments.length, 1);
  assert.equal(t.body.payments[0].amount, 4500);
  assert.equal(t.body.maintenance.length, 1);
  assert.equal(t.body.maintenance[0].status_label, 'In progress');
  // never the other tenant's or company's lease
  assert.ok(!JSON.stringify(t.body).includes(s.bLease.id));
});

test('a customer with no lease has no tenancy and cannot report maintenance', async () => {
  const token = await signIn('0249998888', 'alexis-pearl', 'No Lease');
  assert.equal((await call('GET', `${ACC}/overview`, { token })).body.has_tenancy, false);
  const t = await call('GET', `${ACC}/tenancy`, { token });
  assert.equal(t.body.leases.length, 0);
  assert.equal((await call('POST', `${ACC}/maintenance`, { token, body: { title: 'Broken door', description: 'It is broken badly' } })).status, 409);
});

test('maintenance request creates a company-scoped ticket on the tenant\'s property, visible to staff', async () => {
  const token = await signIn('+233204444444');
  assert.equal((await call('POST', `${ACC}/maintenance`, { token, body: { title: 'x', description: 'y' } })).status, 400, 'validated');
  const r = await call('POST', `${ACC}/maintenance`, { token, body: { title: 'No water supply', description: 'The borehole pump has stopped since yesterday.' } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.ticket.status_label, 'Reported');

  const ticket = rows('tickets').find((x) => x.title === 'No water supply');
  assert.equal(ticket.company_id, s.A.id);
  assert.equal(ticket.client_id, s.aTenant.id);
  assert.equal(ticket.property_id, s.aOsu.id, 'attached to the leased property, not one the customer chose');
  assert.equal(ticket.owner_id, null, 'unassigned until staff pick it up');

  // appears in the company property-management workspace
  const pm = await call('GET', '/api/pm', { token: s.t.aOwner });
  assert.ok(pm.body.tickets.some((x) => x.title === 'No water supply'));
  // not in company B's workspace
  assert.ok(!(await call('GET', '/api/pm', { token: s.t.bOwner })).body.tickets.some((x) => x.title === 'No water supply'));

  // staff resolving it is reflected to the tenant
  await call('PATCH', `/api/pm/tickets/${ticket.id}`, { token: s.t.aOwner, body: { status: 'resolved' } });
  const t = await call('GET', `${ACC}/tenancy`, { token });
  assert.equal(t.body.maintenance.find((m) => m.id === ticket.id).status_label, 'Resolved');
});

test('tenancy endpoints reject other-company sessions and anonymous access', async () => {
  const token = await signIn('+233204444444');
  assert.equal((await call('GET', '/api/public/sunrise-homes/account/tenancy', { token })).status, 401);
  assert.equal((await call('GET', `${ACC}/tenancy`)).status, 401);
  assert.equal((await call('POST', `${ACC}/maintenance`, { token: s.t.aOwner, body: { title: 'abc', description: 'staff token' } })).status, 401, 'staff token is not a customer');
});
