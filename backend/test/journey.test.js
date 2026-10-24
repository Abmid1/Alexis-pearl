import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, client, seed, fake, resetRateLimits, firstSlot } from './helpers/setup.js';

let srv; let call; let s;
before(async () => { srv = await startServer(); call = client(srv.base); });
after(() => srv.close());
beforeEach(async () => { s = await seed(); resetRateLimits(); });

const PUB = '/api/public/alexis-pearl';
const rows = (t) => fake.tables[t] || [];

test('1-5: staff create → publish → edit → unpublish, reflected on the public site', async () => {
  const created = await call('POST', '/api/marketing/listings', { token: s.t.aOwner, body: {
    title: 'New 1-bed · Spintex', price: 3500, ptype: 'rent', property_type: 'apartment', neighbourhood: 'Spintex', city: 'Accra', bedrooms: 1, amenities: ['security'],
  } });
  assert.equal(created.status, 200);
  const id = created.body.id;
  assert.equal(created.body.company_id, s.A.id);

  // draft → not public
  assert.equal((await call('GET', `${PUB}/properties/${id}`)).status, 404);
  assert.ok(!(await call('GET', `${PUB}/properties?q=Spintex`)).body.items.length);

  // agents cannot approve; owner can
  assert.equal((await call('POST', `/api/marketing/listings/${id}/submit`, { token: s.t.aOwner })).status, 200);
  assert.equal((await call('POST', `/api/marketing/listings/${id}/approve`, { token: s.t.aAgent1 })).status, 403);
  assert.equal((await call('POST', `/api/marketing/listings/${id}/approve`, { token: s.t.aOwner })).status, 200);

  const pub = await call('GET', `${PUB}/properties/${id}`);
  assert.equal(pub.status, 200);
  assert.equal(pub.body.property.price, 3500);
  assert.equal(pub.body.property.availability.label, 'Available');
  assert.ok((await call('GET', `${PUB}/properties?q=Spintex`)).body.items.some((p) => p.id === id));
  // never on the other company's site
  assert.equal((await call('GET', `/api/public/sunrise-homes/properties/${id}`)).status, 404);

  // edit → public reflects immediately
  assert.equal((await call('PATCH', `/api/marketing/listings/${id}`, { token: s.t.aOwner, body: { price: 3800, availability: 'reserved' } })).status, 200);
  const edited = await call('GET', `${PUB}/properties/${id}`);
  assert.equal(edited.body.property.price, 3800);
  assert.equal(edited.body.property.availability.label, 'Reserved');
  assert.equal(edited.body.property.availability.can_book_viewing, false);
  assert.ok(edited.body.property.availability_confirmed_at);

  // unpublish → gone from detail and search
  assert.equal((await call('POST', `/api/marketing/listings/${id}/unpublish`, { token: s.t.aOwner })).status, 200);
  assert.equal((await call('GET', `${PUB}/properties/${id}`)).status, 404);
  assert.ok(!(await call('GET', `${PUB}/properties?q=Spintex`)).body.items.length);
});

test('6: public search filters, sorts and paginates real records only', async () => {
  const all = await call('GET', `${PUB}/properties`);
  const titles = all.body.items.map((p) => p.title);
  assert.ok(titles.includes(s.aEastLegon.title) && titles.includes(s.aOsu.title));
  assert.ok(!titles.includes(s.aDraft.title), 'draft must not appear');
  assert.ok(!titles.includes(s.aArchived.title), 'archived must not appear');
  assert.ok(!titles.includes(s.aSold.title), 'sold hidden by default');
  assert.ok(!titles.includes(s.bEastLegon.title), 'other company must not appear');
  assert.ok((await call('GET', `${PUB}/properties?availability=all`)).body.items.some((p) => p.title === s.aSold.title));

  const rent = await call('GET', `${PUB}/properties?purpose=rent&beds=2&max_price=7000&q=East%20Legon&amenities=backup_power`);
  assert.deepEqual(rent.body.items.map((p) => p.id), [s.aEastLegon.id]);
  assert.equal((await call('GET', `${PUB}/properties?purpose=buy&type=apartment`)).body.items.length, 0);
  const sorted = await call('GET', `${PUB}/properties?sort=price_desc`);
  assert.equal(sorted.body.items[0].id, s.aOsu.id);
  const page = await call('GET', `${PUB}/properties?per=1&page=2`);
  assert.equal(page.body.items.length, 1);
  assert.equal(page.body.total, 2);
  assert.equal(page.body.pages, 2);

  const detail = await call('GET', `${PUB}/properties/${s.aEastLegon.id}`);
  assert.deepEqual(detail.body.property.images, ['https://img.example/1.jpg']);
  assert.equal(detail.body.property.managed, undefined);
  assert.equal((await call('GET', `${PUB}/properties/${s.aDraft.id}`)).status, 404);
  assert.equal((await call('GET', `${PUB}/properties/not-a-uuid`)).status, 404);
});

test('company profile exposes branding only; unknown slugs 404', async () => {
  const r = await call('GET', PUB);
  assert.equal(r.body.company.name, 'Alexis Pearl');
  assert.equal(r.body.company.settings, undefined);
  assert.equal(r.body.company.whatsapp_phone_number_id, undefined);
  assert.equal((await call('GET', '/api/public/no-such-agency')).status, 404);
  assert.equal((await call('GET', '/api/public/..%2Fadmin')).status, 404);
});

test('7-9: an enquiry enters the correct company CRM, linked to property and customer', async () => {
  const r = await call('POST', `${PUB}/enquiries`, { body: {
    property_id: s.aEastLegon.id, name: 'Ama Serwaa', phone: '024 777 8888', email: 'ama@example.com',
    message: 'Is it still available?', consent: true, idempotency_key: 'key-ama-0001',
  } });
  assert.equal(r.status, 201);
  assert.match(r.body.reference, /^BA-/);

  const enquiry = rows('enquiries').find((e) => e.reference === r.body.reference);
  assert.equal(enquiry.company_id, s.A.id);
  assert.equal(enquiry.property_id, s.aEastLegon.id);
  assert.equal(enquiry.source, 'property_page');
  const lead = rows('leads').find((l) => l.id === enquiry.lead_id);
  assert.equal(lead.company_id, s.A.id);
  assert.equal(lead.source, 'Website');
  assert.equal(lead.phone, '+233247778888');
  assert.ok([s.aAgent1.id, s.aAgent2.id].includes(lead.owner_id), 'round-robin assigned to an A agent');
  const conv = rows('conversations').find((c) => c.id === enquiry.conversation_id);
  assert.equal(conv.unread, true);
  assert.equal(conv.assigned_to, lead.owner_id);
  const msgs = rows('messages').filter((m) => m.conversation_id === conv.id);
  assert.ok(msgs.some((m) => m.direction === 'in' && m.body.includes(s.aEastLegon.title)));
  assert.ok(msgs.some((m) => m.sender_type === 'ai' && m.is_draft === true), 'AI drafts, never auto-sends');
  assert.ok(!rows('outbox').length, 'no external message sent automatically');

  // visible to company A staff, not company B
  const listA = await call('GET', '/api/enquiries', { token: s.t.aOwner });
  assert.ok(listA.body.some((e) => e.reference === r.body.reference && e.property.title === s.aEastLegon.title));
  const listB = await call('GET', '/api/enquiries', { token: s.t.bOwner });
  assert.ok(!listB.body.some((e) => e.reference === r.body.reference));
  const pipeline = await call('GET', '/api/leads', { token: s.t.aOwner });
  assert.ok(pipeline.body.some((l) => l.id === lead.id));
  const inbox = await call('GET', '/api/inbox', { token: s.t.aOwner });
  assert.ok(inbox.body.some((c) => c.id === conv.id && c.pendingDrafts === 1));

  // retry with the same key → same reference, nothing duplicated
  const again = await call('POST', `${PUB}/enquiries`, { body: { property_id: s.aEastLegon.id, name: 'Ama Serwaa', phone: '0247778888', idempotency_key: 'key-ama-0001' } });
  assert.equal(again.status, 200);
  assert.equal(again.body.reference, r.body.reference);
  assert.equal(rows('enquiries').length, 1);
  assert.equal(rows('leads').filter((l) => l.phone === '+233247778888').length, 1);
});

test('deduplication: same phone in another format reuses the lead; names never merge people', async () => {
  // existing lead Kwabena (+233205555555, kwabena@example.com)
  await call('POST', `${PUB}/enquiries`, { body: { property_id: s.aOsu.id, name: 'K. Osei', phone: '0205555555' } });
  assert.equal(rows('leads').filter((l) => l.company_id === s.A.id && l.phone === '+233205555555').length, 1);
  const kw = rows('enquiries')[0];
  assert.equal(kw.lead_id, s.aLead.id);
  assert.equal(rows('leads').find((l) => l.id === s.aLead.id).stage, 'contacted', 'stage untouched');

  // same name, different phone → different person
  await call('POST', `${PUB}/enquiries`, { body: { name: 'Kwabena Osei', phone: '0261234567' } });
  assert.equal(rows('leads').filter((l) => l.name === 'Kwabena Osei').length, 2);

  // phone matches Kwabena but email contradicts → don't merge, flag for staff
  await call('POST', `${PUB}/enquiries`, { body: { name: 'Someone', phone: '+233205555555', email: 'other@example.com' } });
  const flagged = rows('leads').find((l) => l.name === 'Someone');
  assert.ok(flagged && flagged.notes.includes(s.aLead.id));

  // a B lead with the same phone is never touched by an A enquiry
  await call('POST', `${PUB}/enquiries`, { body: { name: 'Akua', phone: '0209999999' } });
  assert.notEqual(rows('enquiries').at(-1).lead_id, s.bLead.id);
});

test('16: invalid and ineligible submissions are rejected cleanly', async () => {
  assert.equal((await call('POST', `${PUB}/enquiries`, { body: { name: 'A' } })).status, 400);
  assert.equal((await call('POST', `${PUB}/enquiries`, { body: { name: 'Ama', phone: 'nope' } })).status, 400);
  const sold = await call('POST', `${PUB}/enquiries`, { body: { property_id: s.aSold.id, name: 'Ama', phone: '0241112222' } });
  assert.equal(sold.status, 409);
  assert.match(sold.body.error, /sold/i);
  // another company's property through this company's site
  assert.equal((await call('POST', `${PUB}/enquiries`, { body: { property_id: s.bEastLegon.id, name: 'Ama', phone: '0241112222' } })).status, 404);
  assert.equal((await call('POST', `${PUB}/enquiries`, { body: { property_id: s.aDraft.id, name: 'Ama', phone: '0241112222' } })).status, 404);
  // honeypot: bots get a fake success and nothing is stored
  const bot = await call('POST', `${PUB}/enquiries`, { body: { name: 'Bot', phone: '0241112222', website: 'http://spam' } });
  assert.equal(bot.status, 200);
  assert.equal(rows('enquiries').length, 0);
  // malformed JSON
  const bad = await fetch(`${srv.base}${PUB}/enquiries`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{oops' });
  assert.equal(bad.status, 400);
});

test('public write endpoints are rate limited', async () => {
  let last;
  for (let i = 0; i < 14; i++) last = await call('POST', `${PUB}/enquiries`, { body: { name: 'Ama' } });
  assert.equal(last.status, 429);
});

test('10-12: viewing request → staff confirm → customer sees confirmation', async () => {
  const slot = await firstSlot(call, s.aEastLegon.id);
  assert.ok(slot, 'slots offered');
  assert.equal((await call('POST', `${PUB}/viewings`, { body: { property_id: s.aEastLegon.id, starts_at: '2020-01-01T09:00:00Z', name: 'Esi', phone: '0243334444' } })).status, 409);

  const req = await call('POST', `${PUB}/viewings`, { body: {
    property_id: s.aEastLegon.id, starts_at: slot.starts_at, name: 'Esi Nyarko', phone: '0243334444', email: 'esi@example.com',
    message: 'Can I bring my partner?', consent: true, idempotency_key: 'view-esi-0001',
  } });
  assert.equal(req.status, 201);
  assert.equal(req.body.viewing.status, 'requested');
  assert.equal(req.body.viewing.status_label, 'Awaiting confirmation', 'never shown as confirmed on submission');

  // appears in A's workspace only
  const listA = await call('GET', '/api/viewings?status=requested', { token: s.t.aOwner });
  const v = listA.body.find((x) => x.reference === req.body.reference);
  assert.ok(v);
  assert.equal(v.property.title, s.aEastLegon.title);
  assert.ok(!(await call('GET', '/api/viewings', { token: s.t.bOwner })).body.length);
  assert.equal((await call('POST', `/api/viewings/${v.id}/confirm`, { token: s.t.bOwner })).status, 404, 'company B cannot confirm A viewings');

  // customer status before confirmation
  const before = await call('POST', `${PUB}/requests/lookup`, { body: { reference: req.body.reference, contact: 'esi@example.com' } });
  assert.equal(before.body.viewings[0].status_label, 'Awaiting confirmation');

  const conf = await call('POST', `/api/viewings/${v.id}/confirm`, { token: s.t.aOwner, body: { agent_id: s.aAgent1.id } });
  assert.equal(conf.status, 200);
  assert.equal(conf.body.status, 'confirmed');
  assert.equal(conf.body.notified.sent, true, 'consented customer notified via outbox');
  assert.equal(rows('outbox').filter((o) => o.ref === 'viewing').length, 1);
  assert.equal(rows('leads').find((l) => l.id === v.lead_id).stage, 'viewing', 'pipeline stage advanced');

  // confirming twice is refused and never double-notifies
  assert.equal((await call('POST', `/api/viewings/${v.id}/confirm`, { token: s.t.aOwner })).status, 409);
  assert.equal(rows('outbox').filter((o) => o.ref === 'viewing').length, 1);

  const afterLookup = await call('POST', `${PUB}/requests/lookup`, { body: { reference: req.body.reference.toLowerCase(), contact: '+233 24 333 4444' } });
  assert.equal(afterLookup.status, 200);
  assert.equal(afterLookup.body.viewings[0].status_label, 'Confirmed');
  assert.equal(afterLookup.body.viewings[0].agent_name, 'Kojo');
  assert.equal(afterLookup.body.viewings[0].staff_note, undefined);
  assert.ok(afterLookup.body.messages.some((m) => m.from === 'agency' && /confirmed/i.test(m.body)));
  assert.ok(!afterLookup.body.messages.some((m) => m.from === 'assistant'), 'AI drafts are never shown to customers');

  // confirmed slot is no longer offered
  const slots = await call('GET', `${PUB}/properties/${s.aEastLegon.id}/slots`);
  assert.ok(!slots.body.slots.some((x) => x.starts_at === slot.starts_at));
});

test('no double booking: overlapping confirmations are refused', async () => {
  const slot = await firstSlot(call, s.aEastLegon.id);
  // two customers request the same slot (allowed: both are just requests)
  const one = await call('POST', `${PUB}/viewings`, { body: { property_id: s.aEastLegon.id, starts_at: slot.starts_at, name: 'One', phone: '0240000011' } });
  const two = await call('POST', `${PUB}/viewings`, { body: { property_id: s.aEastLegon.id, starts_at: slot.starts_at, name: 'Two', phone: '0240000022' } });
  assert.equal(one.status, 201); assert.equal(two.status, 201);
  const [v1, v2] = ['One', 'Two'].map((n) => rows('viewings').find((v) => v.contact_name === n));
  assert.equal((await call('POST', `/api/viewings/${v1.id}/confirm`, { token: s.t.aOwner })).status, 200);
  const clash = await call('POST', `/api/viewings/${v2.id}/confirm`, { token: s.t.aOwner });
  assert.equal(clash.status, 409);
  assert.match(clash.body.error, /clash|overlap/i);
  // staff can decline the second with a customer-facing reason
  const dec = await call('POST', `/api/viewings/${v2.id}/decline`, { token: s.t.aOwner, body: { reason: 'That slot was just taken.' } });
  assert.equal(dec.body.status, 'declined');
  const look = await call('POST', `${PUB}/requests/lookup`, { body: { reference: v2.reference, contact: '0240000022' } });
  assert.equal(look.body.viewings[0].status_label, 'Not available');
  assert.equal(look.body.viewings[0].decline_reason, 'That slot was just taken.');

  // agent double booking across properties is also refused
  const slotOsu = await firstSlot(call, s.aOsu.id);
  const three = await call('POST', `${PUB}/viewings`, { body: { property_id: s.aOsu.id, starts_at: slotOsu.starts_at, name: 'Three', phone: '0240000033' } });
  assert.equal(three.status, 201);
  const v3 = rows('viewings').find((v) => v.contact_name === 'Three');
  const agentOfV1 = rows('viewings').find((v) => v.id === v1.id).agent_id;
  const agentClash = await call('POST', `/api/viewings/${v3.id}/confirm`, { token: s.t.aOwner, body: { agent_id: agentOfV1 } });
  assert.equal(agentClash.status, 409);
});

test('sold/reserved properties take no new viewing requests', async () => {
  const slots = await call('GET', `${PUB}/properties/${s.aSold.id}/slots`);
  assert.equal(slots.body.open, false);
  const r = await call('POST', `${PUB}/viewings`, { body: { property_id: s.aSold.id, starts_at: new Date().toISOString(), name: 'Ama', phone: '0241112222' } });
  assert.equal(r.status, 409);
});

test('14: customers see only their own request, with matching contact', async () => {
  const slot = await firstSlot(call, s.aEastLegon.id);
  const r = await call('POST', `${PUB}/viewings`, { body: { property_id: s.aEastLegon.id, starts_at: slot.starts_at, name: 'Esi', phone: '0243334444' } });
  const ref = r.body.reference;
  assert.equal((await call('POST', `${PUB}/requests/lookup`, { body: { reference: ref, contact: '0249999999' } })).status, 404);
  assert.equal((await call('POST', `${PUB}/requests/lookup`, { body: { reference: ref, contact: 'Esi' } })).status, 404);
  assert.equal((await call('POST', `${PUB}/requests/lookup`, { body: { reference: 'BA-AAAAAAAA', contact: '0243334444' } })).status, 404);
  // the reference does not work on another company's site
  assert.equal((await call('POST', '/api/public/sunrise-homes/requests/lookup', { body: { reference: ref, contact: '0243334444' } })).status, 404);
  const ok = await call('POST', `${PUB}/requests/lookup`, { body: { reference: ref, contact: '0243334444' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('cache-control'), 'no-store');
});

test('customer can cancel or reschedule within policy, and staff see it in the inbox', async () => {
  const slot = await firstSlot(call, s.aEastLegon.id);
  const later = await firstSlot(call, s.aEastLegon.id, 3);
  const r = await call('POST', `${PUB}/viewings`, { body: { property_id: s.aEastLegon.id, starts_at: slot.starts_at, name: 'Esi', phone: '0243334444' } });
  const v = rows('viewings')[0];
  await call('POST', `/api/viewings/${v.id}/confirm`, { token: s.t.aOwner });

  const moved = await call('POST', `${PUB}/requests/${r.body.reference}/viewings/${v.id}/reschedule`, { body: { contact: '0243334444', starts_at: later.starts_at } });
  assert.equal(moved.status, 200);
  assert.equal(moved.body.viewing.status, 'requested', 'a moved viewing needs re-confirmation');
  assert.equal(moved.body.viewing.starts_at, later.starts_at);

  const wrong = await call('POST', `${PUB}/requests/${r.body.reference}/viewings/${v.id}/cancel`, { body: { contact: '0200000000' } });
  assert.equal(wrong.status, 404);
  const cancel = await call('POST', `${PUB}/requests/${r.body.reference}/viewings/${v.id}/cancel`, { body: { contact: '0243334444' } });
  assert.equal(cancel.body.viewing.status, 'cancelled');
  const conv = rows('conversations').find((c) => c.id === rows('enquiries')[0].conversation_id);
  assert.ok(rows('messages').some((m) => m.conversation_id === conv.id && /cancelled/i.test(m.body)));
});

test('staff reply in the inbox reaches the customer tracking page; customer can reply back', async () => {
  const r = await call('POST', `${PUB}/enquiries`, { body: { name: 'Abena', email: 'abena@example.com', message: 'Hello' } });
  const conv = rows('conversations').find((c) => c.contact_addr.startsWith('site:'));
  const owner = rows('leads').find((l) => l.id === conv.lead_id).owner_id;
  const token = owner === s.aAgent1.id ? s.t.aAgent1 : s.t.aAgent2;
  assert.equal((await call('POST', `/api/inbox/${conv.id}/send`, { token, body: { text: 'Hi Abena, yes it is available.' } })).status, 200);
  const look = await call('POST', `${PUB}/requests/lookup`, { body: { reference: r.body.reference, contact: 'ABENA@example.com' } });
  assert.ok(look.body.messages.some((m) => m.from === 'agency' && m.body.includes('available')));
  const reply = await call('POST', `${PUB}/requests/${r.body.reference}/messages`, { body: { contact: 'abena@example.com', body: 'Great, thanks!' } });
  assert.equal(reply.status, 200);
  assert.ok(rows('messages').some((m) => m.conversation_id === conv.id && m.body === 'Great, thanks!'));
});

test('staff record attendance and outcomes; internal notes stay internal', async () => {
  const slot = await firstSlot(call, s.aOsu.id);
  const r = await call('POST', `${PUB}/viewings`, { body: { property_id: s.aOsu.id, starts_at: slot.starts_at, name: 'Yaa', phone: '0245556666' } });
  const v = rows('viewings')[0];
  assert.equal((await call('POST', `/api/viewings/${v.id}/outcome`, { token: s.t.aOwner, body: { status: 'completed' } })).status, 409);
  await call('POST', `/api/viewings/${v.id}/confirm`, { token: s.t.aOwner });
  await call('PATCH', `/api/viewings/${v.id}`, { token: s.t.aOwner, body: { staff_note: 'Buyer seems price sensitive' } });
  const done = await call('POST', `/api/viewings/${v.id}/outcome`, { token: s.t.aOwner, body: { status: 'completed', outcome: 'Liked it, wants second visit' } });
  assert.equal(done.body.status, 'completed');
  const look = await call('POST', `${PUB}/requests/lookup`, { body: { reference: r.body.reference, contact: '0245556666' } });
  const json = JSON.stringify(look.body);
  assert.ok(!json.includes('price sensitive') && !json.includes('second visit'));
  assert.equal(look.body.viewings[0].status_label, 'Completed');
});
