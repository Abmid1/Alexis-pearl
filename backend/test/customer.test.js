import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, client, seed, fake, resetRateLimits, firstSlot } from './helpers/setup.js';

/** Phase 5: customer accounts, saved homes, applications, private documents. */
let srv; let call; let s;
const PUB = '/api/public/alexis-pearl';
const ACC = `${PUB}/account`;
const rows = (t) => fake.tables[t] || [];

before(async () => { srv = await startServer(); call = client(srv.base); });
after(() => srv.close());
beforeEach(async () => { s = await seed(); resetRateLimits(); globalThis.__BILT_LAST_OTP__ = null; });

async function signIn(contact, slug = 'alexis-pearl', name = 'Ama Serwaa') {
  const r = await call('POST', `/api/public/${slug}/account/code`, { body: { contact } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const v = await call('POST', `/api/public/${slug}/account/verify`, { body: { contact, code: globalThis.__BILT_LAST_OTP__, name } });
  assert.equal(v.status, 200, JSON.stringify(v.body));
  return v.body.token;
}

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF').toString('base64');
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]).toString('base64');

test('sign-in code: sent through the outbox redacted, single use, hashed at rest', async () => {
  const r = await call('POST', `${ACC}/code`, { body: { contact: '024 777 8888' } });
  assert.equal(r.status, 200);
  assert.match(r.body.sent_to, /^\+233 •••• ••88$/);
  const code = globalThis.__BILT_LAST_OTP__;
  assert.match(code, /^\d{6}$/);
  assert.ok(!JSON.stringify(r.body).includes(code), 'code never in the response');
  const out = rows('outbox').find((o) => o.ref === 'sign-in-code');
  assert.ok(out && !out.body.includes(code), 'staff cannot read the code in the outbox');
  assert.ok(!rows('customer_otps')[0].code_hash.includes(code));

  const v = await call('POST', `${ACC}/verify`, { body: { contact: '+233247778888', code, name: 'Ama' } });
  assert.equal(v.status, 200);
  assert.ok(v.body.token);
  assert.equal(v.body.client.verified_phone, '+233247778888');
  const again = await call('POST', `${ACC}/verify`, { body: { contact: '+233247778888', code } });
  assert.equal(again.status, 400, 'codes are single use');
});

test('wrong codes lock out after 5 attempts; requests are rate limited per contact', async () => {
  await call('POST', `${ACC}/code`, { body: { contact: 'ama@example.com' } });
  const good = globalThis.__BILT_LAST_OTP__;
  const bad = good === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++) assert.equal((await call('POST', `${ACC}/verify`, { body: { contact: 'ama@example.com', code: bad } })).status, 400);
  const locked = await call('POST', `${ACC}/verify`, { body: { contact: 'ama@example.com', code: good } });
  assert.equal(locked.status, 429, 'even the right code is refused once locked');
  await call('POST', `${ACC}/code`, { body: { contact: 'ama@example.com' } });
  await call('POST', `${ACC}/code`, { body: { contact: 'ama@example.com' } });
  assert.equal((await call('POST', `${ACC}/code`, { body: { contact: 'ama@example.com' } })).status, 429);
  assert.equal((await call('POST', `${ACC}/code`, { body: { contact: 'not a contact' } })).status, 400);
});

test('expired codes are refused', async () => {
  await call('POST', `${ACC}/code`, { body: { contact: '0247778888' } });
  rows('customer_otps')[0].expires_at = new Date(Date.now() - 1000).toISOString();
  assert.equal((await call('POST', `${ACC}/verify`, { body: { contact: '0247778888', code: globalThis.__BILT_LAST_OTP__ } })).status, 400);
});

test('in production, sign-in is refused when no provider can deliver the code', async () => {
  process.env.NODE_ENV = 'production';
  try {
    const r = await call('POST', `${ACC}/code`, { body: { contact: 'ama@example.com' } });
    assert.equal(r.status, 503);
    assert.equal(rows('customer_otps').length, 0);
  } finally { process.env.NODE_ENV = 'test'; }
});

test('sessions are scoped to one agency and never work on staff routes', async () => {
  const token = await signIn('0247778888');
  assert.equal((await call('GET', `${ACC}/me`, { token })).status, 200);
  assert.equal((await call('GET', '/api/public/sunrise-homes/account/me', { token })).status, 401, 'agency A session on agency B');
  assert.equal((await call('GET', '/api/leads', { token })).status, 401, 'customer token on staff API');
  assert.equal((await call('GET', '/api/portal', { token })).status, 401);
  assert.equal((await call('GET', `${ACC}/me`, { token: s.t.aOwner })).status, 401, 'staff token is not a customer session');
  assert.equal((await call('GET', `${ACC}/overview`)).status, 401);
});

test('a staff-created client is adopted only when the contact matches exactly one record', async () => {
  // seed has client Nana Adjei +233201111111 (no verified contact yet)
  await signIn('0201111111', 'alexis-pearl', 'Someone');
  const nana = rows('clients').find((c) => c.id === s.aClient.id);
  assert.equal(nana.verified_phone, '+233201111111');
  assert.equal(nana.name, 'Nana Adjei', 'existing name kept');
  assert.equal(rows('clients').filter((c) => c.verified_phone === '+233201111111').length, 1);
});

test('14: overview shows only requests made with the verified contact', async () => {
  const slot = await firstSlot(call, s.aEastLegon.id);
  await call('POST', `${PUB}/viewings`, { body: { property_id: s.aEastLegon.id, starts_at: slot.starts_at, name: 'Ama', phone: '0247778888' } });
  await call('POST', `${PUB}/enquiries`, { body: { name: 'Somebody else', phone: '0209990000', message: 'private' } });
  await call('POST', '/api/public/sunrise-homes/enquiries', { body: { name: 'Ama', phone: '0247778888', message: 'other agency' } });

  const token = await signIn('+233247778888');
  const o = await call('GET', `${ACC}/overview`, { token });
  assert.equal(o.status, 200);
  assert.equal(o.body.enquiries.length, 1, 'only my enquiry, only at this agency');
  assert.equal(o.body.enquiries[0].viewings[0].status_label, 'Awaiting confirmation');
  assert.ok(!JSON.stringify(o.body).includes('private'));
  assert.ok(!JSON.stringify(o.body).includes('other agency'));

  // renaming yourself never grants access to someone else's requests
  await call('PATCH', `${ACC}/me`, { token, body: { name: 'Somebody else' } });
  assert.equal((await call('GET', `${ACC}/overview`, { token })).body.enquiries.length, 1);
});

test('saved homes sync across devices and drop unpublished listings', async () => {
  const token = await signIn('0247778888');
  const sync = await call('POST', `${ACC}/saved/sync`, { token, body: { ids: [s.aEastLegon.id, s.aOsu.id, s.aDraft.id, s.bEastLegon.id, 'junk'] } });
  assert.deepEqual(sync.body.items.map((p) => p.id).sort(), [s.aEastLegon.id, s.aOsu.id].sort());
  assert.equal((await call('POST', `${ACC}/saved`, { token, body: { property_id: s.bEastLegon.id } })).status, 404);
  await call('POST', `/api/marketing/listings/${s.aOsu.id}/unpublish`, { token: s.t.aOwner });
  assert.deepEqual((await call('GET', `${ACC}/saved`, { token })).body.items.map((p) => p.id), [s.aEastLegon.id]);
  await call('DELETE', `${ACC}/saved/${s.aEastLegon.id}`, { token });
  assert.equal((await call('GET', `${ACC}/saved`, { token })).body.items.length, 0);
});

test('application → staff review → documents → decision, end to end', async () => {
  const token = await signIn('0247778888', 'alexis-pearl', 'Ama Serwaa');
  const bad = await call('POST', `${ACC}/applications`, { token, body: { property_id: s.aEastLegon.id, answers: { occupants: 'lots' } } });
  assert.equal(bad.status, 400);
  const created = await call('POST', `${ACC}/applications`, { token, body: { property_id: s.aEastLegon.id, answers: { move_in: '2026-12-01', occupants: 2, ignored: 'x' }, idempotency_key: 'app-key-0001' } });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const app = created.body.application;
  assert.equal(app.status_label, 'Submitted');
  assert.equal(app.kind, 'rental');
  const stored = rows('applications')[0];
  assert.deepEqual(stored.answers, { move_in: '2026-12-01', occupants: 2 });
  // it entered the CRM: lead + inbox conversation + enquiry of kind application
  const enq = rows('enquiries').find((e) => e.id === stored.enquiry_id);
  assert.equal(enq.kind, 'application');
  assert.equal(rows('leads').find((l) => l.id === stored.lead_id).company_id, s.A.id);
  // retry is idempotent; a second open application for the same home is refused
  assert.equal((await call('POST', `${ACC}/applications`, { token, body: { property_id: s.aEastLegon.id, idempotency_key: 'app-key-0001' } })).body.duplicate, true);
  assert.equal((await call('POST', `${ACC}/applications`, { token, body: { property_id: s.aEastLegon.id } })).status, 409);
  assert.equal((await call('POST', `${ACC}/applications`, { token, body: { property_id: s.aSold.id } })).status, 409);

  // staff ask for documents
  const list = await call('GET', '/api/applications', { token: s.t.aOwner });
  assert.equal(list.body.length, 1);
  assert.equal((await call('GET', '/api/applications', { token: s.t.bOwner })).body.length, 0);
  const ask = await call('POST', `/api/applications/${app.id}/status`, { token: s.t.aOwner, body: { status: 'info_requested', message: 'Please send ID.', requested_documents: ['Ghana Card'] } });
  assert.equal(ask.status, 200);
  assert.equal(ask.body.notified.sent, true);
  const seen = await call('GET', `${ACC}/applications/${app.id}`, { token });
  assert.equal(seen.body.application.status_label, 'More information needed');
  assert.deepEqual(seen.body.application.requested_documents, [{ label: 'Ghana Card' }]);
  assert.equal(seen.body.application.customer_message, 'Please send ID.');

  // uploads: real type detection, size limit, private storage
  const fake1 = await call('POST', `${ACC}/applications/${app.id}/documents`, { token, body: { file_name: 'id.pdf', content_base64: Buffer.from('MZ fake exe').toString('base64') } });
  assert.equal(fake1.status, 400, 'an executable renamed .pdf is rejected');
  const big = await call('POST', `${ACC}/applications/${app.id}/documents`, { token, body: { file_name: 'big.pdf', content_base64: Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(8 * 1024 * 1024)]).toString('base64') } });
  assert.equal(big.status, 400);
  const up = await call('POST', `${ACC}/applications/${app.id}/documents`, { token, body: { file_name: '../../etc/passwd.png', label: 'Ghana Card', content_base64: PNG } });
  assert.equal(up.status, 201, JSON.stringify(up.body));
  assert.equal(up.body.document.file_name, 'passwd.png', 'path segments stripped from the file name');
  const doc = rows('application_documents')[0];
  assert.ok(doc.storage_path.startsWith(`${s.A.id}/applications/${app.id}/`), 'stored under company/applications/<id>');
  assert.ok(!doc.file_name.includes('/'));
  assert.equal(doc.mime_type, 'image/png');
  await call('POST', `${ACC}/applications/${app.id}/documents`, { token, body: { file_name: 'payslip', content_base64: PDF } });
  assert.equal(rows('application_documents')[1].file_name, 'payslip.pdf');

  // download links: owner yes; other customer / other company no
  const link = await call('GET', `${ACC}/applications/${app.id}/documents/${doc.id}`, { token });
  assert.match(link.body.url, /^https:\/\/storage\.test\/object\/sign\//);
  assert.equal(link.body.expires_in, 60);
  const other = await signIn('0261112222', 'alexis-pearl', 'Other Person');
  assert.equal((await call('GET', `${ACC}/applications/${app.id}`, { token: other })).status, 404);
  assert.equal((await call('GET', `${ACC}/applications/${app.id}/documents/${doc.id}`, { token: other })).status, 404);
  assert.equal((await call('POST', `${ACC}/applications/${app.id}/documents`, { token: other, body: { file_name: 'x.pdf', content_base64: PDF } })).status, 404);
  assert.equal((await call('GET', `/api/applications/${app.id}/documents/${doc.id}`, { token: s.t.bOwner })).status, 404);
  const staffLink = await call('GET', `/api/applications/${app.id}/documents/${doc.id}`, { token: s.t.aOwner });
  assert.equal(staffLink.status, 200);
  assert.ok(rows('audit_log').some((a) => a.action === 'document_accessed' && a.user_id === s.aOwner.id), 'staff access is logged');

  // agents cannot approve; managers can; internal notes stay internal
  const agentTok = rows('leads').find((l) => l.id === stored.lead_id).owner_id === s.aAgent1.id ? s.t.aAgent1 : s.t.aAgent2;
  assert.equal((await call('POST', `/api/applications/${app.id}/status`, { token: agentTok, body: { status: 'approved' } })).status, 403);
  await call('PATCH', `/api/applications/${app.id}`, { token: s.t.aOwner, body: { staff_note: 'Income looks thin' } });
  const ok = await call('POST', `/api/applications/${app.id}/status`, { token: s.t.aOwner, body: { status: 'approved', message: 'We will call you to arrange signing.' } });
  assert.equal(ok.body.status, 'approved');
  const final = await call('GET', `${ACC}/applications/${app.id}`, { token });
  assert.equal(final.body.application.status_label, 'Approved');
  assert.ok(!JSON.stringify(final.body).includes('Income looks thin'));
  assert.equal(final.body.application.can_upload, false);
  assert.equal((await call('POST', `${ACC}/applications/${app.id}/documents`, { token, body: { file_name: 'late.pdf', content_base64: PDF } })).status, 409);
  assert.equal((await call('POST', `/api/applications/${app.id}/status`, { token: s.t.aOwner, body: { status: 'info_requested', message: 'x' } })).status, 409, 'invalid transition');
});

test('customer can withdraw an open application', async () => {
  const token = await signIn('0247778888');
  const created = await call('POST', `${ACC}/applications`, { token, body: { property_id: s.aOsu.id } });
  assert.equal(created.body.application.kind, 'purchase');
  const w = await call('POST', `${ACC}/applications/${created.body.application.id}/withdraw`, { token });
  assert.equal(w.body.application.status, 'withdrawn');
  assert.equal((await call('POST', `${ACC}/applications`, { token, body: { property_id: s.aOsu.id } })).status, 201, 'can re-apply after withdrawing');
});

test('agencies configure their own application questions', async () => {
  const bad = await call('PATCH', '/api/company', { token: s.t.aOwner, body: { application_form: [{ label: '', type: 'text' }] } });
  assert.equal(bad.status, 400);
  const ok = await call('PATCH', '/api/company', { token: s.t.aOwner, body: { application_form: [
    { label: 'Employer', type: 'text', required: true }, { label: 'Pets?', type: 'yesno' }, { label: 'Lease length', type: 'select', options: '1 year, 2 years' },
  ] } });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.application_form.map((q) => q.key), ['employer', 'pets', 'lease_length']);
  const token = await signIn('0247778888');
  assert.equal((await call('GET', `${ACC}/form`, { token })).body.form.length, 3);
  const missing = await call('POST', `${ACC}/applications`, { token, body: { property_id: s.aEastLegon.id, answers: { pets: 'maybe' } } });
  assert.equal(missing.status, 400);
  assert.match(missing.body.error, /Employer.*required/);
  const good = await call('POST', `${ACC}/applications`, { token, body: { property_id: s.aEastLegon.id, answers: { employer: 'MTN', pets: 'No', lease_length: '2 years' } } });
  assert.equal(good.status, 201, JSON.stringify(good.body));
});
