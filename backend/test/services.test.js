import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, client, seed, fake, resetRateLimits } from './helpers/setup.js';

/** Document requests, landlord/service submissions, offers and transaction milestones. */
let srv; let call; let s;
const PUB = '/api/public/alexis-pearl';
const ACC = `${PUB}/account`;
const rows = (t) => fake.tables[t] || [];
const PDF = Buffer.from('%PDF-1.4 issued document').toString('base64');

before(async () => { srv = await startServer(); call = client(srv.base); });
after(() => srv.close());
beforeEach(async () => { s = await seed(); resetRateLimits(); globalThis.__BILT_LAST_OTP__ = null; });

async function signIn(contact, slug = 'alexis-pearl', name = 'Abena Sarpong') {
  await call('POST', `/api/public/${slug}/account/code`, { body: { contact } });
  const v = await call('POST', `/api/public/${slug}/account/verify`, { body: { contact, code: globalThis.__BILT_LAST_OTP__, name } });
  return v.body.token;
}
const tenant = () => signIn('+233204444444');

// ───────────────────────── document requests ─────────────────────────
test('catalogue shows only enabled documents, and a request reaches staff', async () => {
  const token = await tenant();
  const list = await call('GET', `${ACC}/documents`, { token });
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.catalogue.map((d) => d.key), ['payment_statement', 'clearance_certificate']);
  assert.ok(!JSON.stringify(list.body.catalogue).includes('retired_doc'), 'disabled entries are hidden');

  assert.equal((await call('POST', `${ACC}/documents`, { token, body: { doc_key: 'retired_doc' } })).status, 404);
  assert.equal((await call('POST', `${ACC}/documents`, { token, body: { doc_key: 'nope' } })).status, 404);

  const r = await call('POST', `${ACC}/documents`, { token, body: { doc_key: 'clearance_certificate', note: 'For my bank', idempotency_key: 'doc-key-0001' } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.request.document, 'Clearance certificate');
  assert.equal(r.body.request.fee, 250);
  assert.equal(r.body.request.status_label, 'Requested');
  assert.equal((await call('POST', `${ACC}/documents`, { token, body: { doc_key: 'clearance_certificate', idempotency_key: 'doc-key-0001' } })).body.duplicate, true);
  assert.equal(rows('document_requests').length, 1);
  assert.equal(rows('document_requests')[0].company_id, s.A.id);

  const staff = await call('GET', '/api/document-requests', { token: s.t.aOwner });
  assert.equal(staff.body.length, 1);
  assert.equal(staff.body[0].client.name, 'Abena Sarpong');
  assert.equal((await call('GET', '/api/document-requests', { token: s.t.bOwner })).body.length, 0);
});

test('a document cannot be marked ready before it is uploaded; the customer then opens it', async () => {
  const token = await tenant();
  const id = (await call('POST', `${ACC}/documents`, { token, body: { doc_key: 'payment_statement' } })).body.request.id;

  assert.equal((await call('POST', `/api/document-requests/${id}/status`, { token: s.t.aOwner, body: { status: 'ready' } })).status, 409);
  assert.equal((await call('POST', `/api/document-requests/${id}/status`, { token: s.t.aOwner, body: { status: 'cancelled' } })).status, 400);
  assert.equal((await call('POST', `/api/document-requests/${id}/status`, { token: s.t.aOwner, body: { status: 'in_progress' } })).status, 200);

  const bad = await call('POST', `/api/document-requests/${id}/files`, { token: s.t.aOwner, body: { file_name: 'x.pdf', content_base64: Buffer.from('MZ not a pdf').toString('base64') } });
  assert.equal(bad.status, 400, 'file contents are checked, not the name');
  const up = await call('POST', `/api/document-requests/${id}/files`, { token: s.t.aOwner, body: { file_name: 'statement.pdf', content_base64: PDF } });
  assert.equal(up.status, 201);
  assert.ok(up.body.storage_path.startsWith(`${s.A.id}/document-requests/${id}/`));

  const ready = await call('POST', `/api/document-requests/${id}/status`, { token: s.t.aOwner, body: { status: 'ready', message: 'Attached.' } });
  assert.equal(ready.body.status, 'ready');
  assert.equal(ready.body.notified.sent, true);

  const mine = await call('GET', `${ACC}/documents`, { token });
  const req1 = mine.body.requests[0];
  assert.equal(req1.status_label, 'Ready');
  assert.equal(req1.files.length, 1);
  const link = await call('GET', `${ACC}/documents/${id}/files/${req1.files[0].id}`, { token });
  assert.match(link.body.url, /^https:\/\/storage\.test\//);

  // another customer and another company cannot reach it
  const other = await signIn('0261112222', 'alexis-pearl', 'Other');
  assert.equal((await call('GET', `${ACC}/documents/${id}/files/${req1.files[0].id}`, { token: other })).status, 404);
  assert.equal((await call('GET', `/api/document-requests/${id}/files/${req1.files[0].id}`, { token: s.t.bOwner })).status, 404);
  assert.ok(rows('audit_log').some((a) => a.action === 'document_accessed'));
});

test('customers may only request documents for a property they rent or applied for', async () => {
  const token = await tenant();
  const wrong = await call('POST', `${ACC}/documents`, { token, body: { doc_key: 'payment_statement', property_id: s.aEastLegon.id } });
  assert.equal(wrong.status, 403);
  const ok = await call('POST', `${ACC}/documents`, { token, body: { doc_key: 'payment_statement', property_id: s.aOsu.id } });
  assert.equal(ok.status, 201, 'the property they lease is allowed');
  assert.equal((await call('POST', `${ACC}/documents`, { token, body: { doc_key: 'payment_statement', property_id: s.bEastLegon.id } })).status, 404);
});

test('a customer can cancel an open document request', async () => {
  const token = await tenant();
  const id = (await call('POST', `${ACC}/documents`, { token, body: { doc_key: 'payment_statement' } })).body.request.id;
  assert.equal((await call('POST', `${ACC}/documents/${id}/cancel`, { token })).body.request.status, 'cancelled');
  assert.equal((await call('POST', `${ACC}/documents/${id}/cancel`, { token })).status, 409);
});

// ───────────────────────── landlord & service requests ─────────────────────────
test('services offered follow the agency configuration', async () => {
  // the seed agency offers buy + rent, so only relocation help is on offer
  const before = await call('GET', `${PUB}/services`);
  assert.deepEqual(before.body.services.map((x) => x.key), ['relocation']);
  assert.equal((await call('POST', `${PUB}/services`, { body: { kind: 'valuation', name: 'Kofi', phone: '0244111222', details: {} } })).status, 409, 'a service the agency does not offer is refused');

  await call('PATCH', '/api/company', { token: s.t.aOwner, body: { services: ['buy', 'rent', 'sell', 'valuation'] } });
  const after = await call('GET', `${PUB}/services`);
  assert.deepEqual(after.body.services.map((x) => x.key).sort(), ['list_property', 'relocation', 'valuation']);
  assert.ok(after.body.services.find((x) => x.key === 'list_property').fields.length > 3);
});

test('a landlord submission becomes a CRM lead and can become a draft listing', async () => {
  await call('PATCH', '/api/company', { token: s.t.aOwner, body: { services: ['buy', 'rent', 'sell'] } });
  assert.equal((await call('POST', `${PUB}/services`, { body: { kind: 'list_property', name: 'Kofi Mensah', phone: '0244111222', details: { purpose: 'Rent out' } } })).status, 400, 'required fields validated');

  const r = await call('POST', `${PUB}/services`, { body: {
    kind: 'list_property', name: 'Kofi Mensah', phone: '0244111222', consent: true, idempotency_key: 'svc-key-0001',
    details: { purpose: 'Rent out', property_type: 'Apartment', location: 'Spintex', bedrooms: 2, asking_price: 4200, description: 'Newly built' },
  } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const sr = rows('service_requests')[0];
  assert.equal(sr.company_id, s.A.id);
  assert.equal(sr.kind, 'list_property');
  // it entered the CRM as a lead + inbox conversation
  const lead = rows('leads').find((l) => l.id === sr.lead_id);
  assert.equal(lead.source, 'Website');
  assert.ok(rows('messages').some((m) => m.body.includes('List my property')));
  assert.equal((await call('POST', `${PUB}/services`, { body: { kind: 'list_property', name: 'Kofi Mensah', phone: '0244111222', idempotency_key: 'svc-key-0001', details: { purpose: 'Rent out', property_type: 'Apartment', location: 'Spintex' } } })).body.duplicate, true);
  assert.equal(rows('service_requests').length, 1);

  // the landlord tracks it with the same reference
  const track = await call('POST', `${PUB}/requests/lookup`, { body: { reference: r.body.reference, contact: '0244111222' } });
  assert.equal(track.status, 200);

  // staff convert it to a DRAFT listing — never published
  assert.equal((await call('POST', `/api/service-requests/${sr.id}/convert`, { token: s.t.aAgent1 })).status, 403, 'managers only');
  const conv = await call('POST', `/api/service-requests/${sr.id}/convert`, { token: s.t.aOwner });
  assert.equal(conv.status, 201, JSON.stringify(conv.body));
  assert.equal(conv.body.property.listing_status, 'draft');
  assert.equal(conv.body.property.ptype, 'rent');
  assert.equal(conv.body.property.price, 4200);
  assert.equal(conv.body.property.company_id, s.A.id);
  assert.ok(!(await call('GET', `${PUB}/properties?q=Spintex`)).body.items.length, 'a draft never shows publicly');
  assert.equal((await call('POST', `/api/service-requests/${sr.id}/convert`, { token: s.t.aOwner })).status, 409, 'converted once');
  assert.equal((await call('GET', '/api/service-requests', { token: s.t.bOwner })).body.length, 0);
});

// ───────────────────────── offers ─────────────────────────
test('offer lifecycle: draft, send, customer accepts; expiry and isolation respected', async () => {
  const token = await tenant();
  assert.equal((await call('POST', '/api/offers', { token: s.t.aAgent1, body: { client_id: s.aTenant.id, property_id: s.aOsu.id, amount: 1000 } })).status, 403, 'managers only');
  assert.equal((await call('POST', '/api/offers', { token: s.t.aOwner, body: { client_id: s.aTenant.id, property_id: s.bEastLegon.id, amount: 1000 } })).status, 400, 'foreign property refused');

  const made = await call('POST', '/api/offers', { token: s.t.aOwner, body: {
    client_id: s.aTenant.id, property_id: s.aOsu.id, amount: 4800, terms: 'Two years advance.',
    expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
  } });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const id = made.body.id;
  assert.equal(made.body.status, 'draft');
  assert.equal((await call('GET', `${ACC}/offers`, { token })).body.offers.length, 0, 'drafts are never shown to the customer');

  const sent = await call('POST', `/api/offers/${id}/send`, { token: s.t.aOwner });
  assert.equal(sent.body.status, 'sent');
  assert.equal(sent.body.notified.sent, true);
  assert.equal((await call('POST', `/api/offers/${id}/send`, { token: s.t.aOwner })).status, 409, 'cannot send twice');
  assert.equal(rows('outbox').filter((o) => o.ref === 'offer').length, 1, 'never notified twice');

  const mine = await call('GET', `${ACC}/offers`, { token });
  assert.equal(mine.body.offers.length, 1);
  assert.equal(mine.body.offers[0].status_label, 'Awaiting your response');
  assert.equal(mine.body.offers[0].can_respond, true);
  assert.match(mine.body.offers[0].disclaimer, /not a contract/i);
  assert.equal(mine.body.offers[0].staff_note, undefined);

  // another customer cannot respond
  const other = await signIn('0261112222', 'alexis-pearl', 'Other');
  assert.equal((await call('POST', `${ACC}/offers/${id}/respond`, { token: other, body: { accept: true } })).status, 404);
  assert.equal((await call('POST', `${ACC}/offers/${id}/respond`, { token, body: {} })).status, 400);

  const acc = await call('POST', `${ACC}/offers/${id}/respond`, { token, body: { accept: true, note: 'Happy to proceed' } });
  assert.equal(acc.body.offer.status, 'accepted');
  assert.equal((await call('POST', `${ACC}/offers/${id}/respond`, { token, body: { accept: false } })).status, 409, 'answered once');
  assert.equal((await call('PATCH', `/api/offers/${id}`, { token: s.t.aOwner, body: { amount: 1 } })).status, 409, 'a sent offer is not editable');
});

test('an offer past its response date reads as expired and cannot be answered', async () => {
  const token = await tenant();
  const id = (await call('POST', '/api/offers', { token: s.t.aOwner, body: { client_id: s.aTenant.id, property_id: s.aOsu.id, amount: 100 } })).body.id;
  await call('POST', `/api/offers/${id}/send`, { token: s.t.aOwner });
  rows('offers').find((o) => o.id === id).expires_at = new Date(Date.now() - 1000).toISOString();
  const mine = await call('GET', `${ACC}/offers`, { token });
  assert.equal(mine.body.offers[0].status_label, 'Expired');
  assert.equal(mine.body.offers[0].can_respond, false);
  assert.equal((await call('POST', `${ACC}/offers/${id}/respond`, { token, body: { accept: true } })).status, 409);
});

// ───────────────────────── transactions ─────────────────────────
test('transaction milestones are created from a template and shown as progress', async () => {
  const token = await tenant();
  const made = await call('POST', '/api/transactions', { token: s.t.aOwner, body: { client_id: s.aTenant.id, property_id: s.aOsu.id, kind: 'rental' } });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  assert.equal(made.body.milestones.length, 5);
  assert.ok(made.body.milestones.every((m) => m.state === 'pending'));

  const mine = await call('GET', `${ACC}/transactions`, { token });
  assert.equal(mine.body.transactions[0].progress.done, 0);
  assert.equal(mine.body.transactions[0].current_step, 'Application approved');

  const updated = [...made.body.milestones];
  updated[0] = { ...updated[0], state: 'done' };
  updated[1] = { ...updated[1], state: 'in_progress', note: 'Agreement with the lawyer' };
  const patched = await call('PATCH', `/api/transactions/${made.body.id}`, { token: s.t.aOwner, body: { milestones: updated, customer_message: 'Moving along nicely', staff_note: 'internal only' } });
  assert.equal(patched.status, 200);
  assert.ok(patched.body.milestones[0].completed_at, 'completion is timestamped');

  const after = await call('GET', `${ACC}/transactions`, { token });
  const t = after.body.transactions[0];
  assert.equal(t.progress.done, 1);
  assert.equal(t.current_step, 'Tenancy agreement signed');
  assert.equal(t.customer_message, 'Moving along nicely');
  assert.ok(!JSON.stringify(t).includes('internal only'), 'staff notes stay internal');

  assert.equal((await call('GET', '/api/transactions', { token: s.t.bOwner })).body.length, 0);
  assert.equal((await call('PATCH', `/api/transactions/${made.body.id}`, { token: s.t.bOwner, body: { status: 'cancelled' } })).status, 404);
  const otherToken = await signIn('0261112222', 'alexis-pearl', 'Other');
  assert.equal((await call('GET', `${ACC}/transactions`, { token: otherToken })).body.transactions.length, 0);
});

test('the account overview counts the new sections', async () => {
  const token = await tenant();
  await call('POST', `${ACC}/documents`, { token, body: { doc_key: 'payment_statement' } });
  const id = (await call('POST', '/api/offers', { token: s.t.aOwner, body: { client_id: s.aTenant.id, property_id: s.aOsu.id, amount: 100 } })).body.id;
  await call('POST', `/api/offers/${id}/send`, { token: s.t.aOwner });
  await call('POST', '/api/transactions', { token: s.t.aOwner, body: { client_id: s.aTenant.id, kind: 'sale' } });
  const o = await call('GET', `${ACC}/overview`, { token });
  assert.equal(o.body.document_requests, 1);
  assert.equal(o.body.offers, 1);
  assert.equal(o.body.offers_awaiting, 1);
  assert.equal(o.body.transactions, 1);
  assert.equal(o.body.has_tenancy, true);
});
