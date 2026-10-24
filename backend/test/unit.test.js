import { test } from 'node:test';
import assert from 'node:assert/strict';
import './helpers/setup.js';
import { normalizePhone, phoneVariants, normalizeEmail, contactMatches, makeReference } from '../src/lib/contacts.js';
import { validateContact } from '../src/lib/enquiry.js';
import { generateSlots, findSlot, withinCustomerCutoff } from '../src/lib/scheduling.js';
import { parseFilters, safeText } from '../src/lib/publicSearch.js';
import { ruleFilters, pricesGrounded } from '../src/lib/assistant.js';
import { toPublicProperty, cleanListingInput, publicAvailability, isPublic } from '../src/lib/listing.js';
import { tenantDb } from '../src/lib/tenant.js';

test('Ghana phone numbers normalise to one canonical form', () => {
  for (const v of ['0244000001', '+233244000001', '233 24 400 0001', '244000001', '+233 0244000001', '00233244000001']) {
    assert.equal(normalizePhone(v), '+233244000001', v);
  }
  assert.equal(normalizePhone('12'), null);
  assert.equal(normalizePhone('+2332440000011'), null);   // too long for Ghana
  assert.equal(normalizePhone('+447700900123'), '+447700900123');
  assert.deepEqual(new Set(phoneVariants('+233244000001')), new Set(['+233244000001', '233244000001', '0244000001']));
});

test('email normalisation and contact matching never use names', () => {
  assert.equal(normalizeEmail('  Ama@Example.COM '), 'ama@example.com');
  assert.equal(normalizeEmail('not-an-email'), null);
  assert.ok(contactMatches('0244000001', { phone: '+233244000001' }));
  assert.ok(contactMatches('AMA@example.com', { email: 'ama@example.com' }));
  assert.ok(!contactMatches('Ama Serwaa', { phone: '+233244000001', email: 'ama@example.com' }));
  assert.ok(!contactMatches('', { phone: '+233244000001' }));
});

test('references are unambiguous and random', () => {
  const r = makeReference();
  assert.match(r, /^BA-[A-HJ-NP-Z2-9]{8}$/);
  assert.notEqual(r, makeReference());
});

test('contact validation requires a name and one reachable contact', () => {
  assert.ok(validateContact({ name: 'A', phone: '0244000001' }).errors.length);
  assert.ok(validateContact({ name: 'Ama' }).errors.length);
  assert.ok(validateContact({ name: 'Ama', phone: 'abc' }).errors.length);
  const ok = validateContact({ name: ' Ama ', phone: '0244000001', consent: 'yes', message: 'x'.repeat(5000) });
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.value.phone, '+233244000001');
  assert.equal(ok.value.consent, false);                 // only literal true counts as consent
  assert.equal(ok.value.message.length, 2000);
});

test('slot generation respects days, hours, notice and confirmed viewings', () => {
  const now = new Date('2026-10-26T10:00:00Z');          // Monday
  const hours = { days: [1, 2], start: '09:00', end: '12:00', slot_minutes: 60, min_notice_hours: 24, max_days_ahead: 8 };
  const slots = generateSlots(hours, { now });
  assert.ok(slots.length > 0);
  for (const s of slots) {
    const d = new Date(s.starts_at);
    assert.ok([1, 2].includes(d.getUTCDay()));
    assert.ok(d.getUTCHours() >= 9 && d.getUTCHours() < 12);
    assert.ok(d - now >= 24 * 3600000);
  }
  const busy = [{ starts_at: slots[0].starts_at, ends_at: slots[0].ends_at }];
  assert.ok(!generateSlots(hours, { now, busy }).some((s) => s.starts_at === slots[0].starts_at));
  assert.ok(findSlot(hours, slots[1].starts_at, { now }));
  assert.equal(findSlot(hours, '2026-10-27T09:30:00Z', { now }), null);  // not on the slot grid
  assert.equal(findSlot(hours, 'garbage', { now }), null);
  assert.ok(withinCustomerCutoff({ cancel_cutoff_hours: 2 }, '2026-10-26T13:00:00Z', now));
  assert.ok(!withinCustomerCutoff({ cancel_cutoff_hours: 2 }, '2026-10-26T11:00:00Z', now));
});

test('public filters are whitelisted and filter strings cannot inject', () => {
  const f = parseFilters({ purpose: 'rent', type: 'apartment', q: 'East Legon),listing_status.eq.draft', beds: '2', max_price: '-5', sort: 'drop', per: '999', amenities: 'backup_power,<script>' });
  assert.equal(f.purpose, 'rent');
  assert.equal(f.beds, 2);
  assert.equal(f.max_price, undefined);
  assert.equal(f.sort, 'newest');
  assert.equal(f.per, 48);
  assert.ok(!/[(),]/.test(f.q));
  assert.deepEqual(f.amenities, ['backup_power', 'script']);
  assert.equal(parseFilters({ type: 'castle' }).type, undefined);
  assert.equal(safeText('a,b(c)*d%'), 'a b c d');
});

test('public property shape is a whitelist', () => {
  const p = toPublicProperty({ id: '1', title: 't', ptype: 'rent', price: '100', images: ['https://x/a.jpg', 'http://x/b.jpg', 'javascript:1'], managed: true, listing_status: 'published', lat: 5, lng: -0.1, description: 'd', availability: 'sold' }, { full: true });
  assert.equal(p.managed, undefined);
  assert.equal(p.listing_status, undefined);
  assert.deepEqual(p.images, ['https://x/a.jpg']);
  assert.equal(p.map, null);                                // exact location hidden unless allowed
  assert.equal(p.rent_period, 'month');
  assert.equal(p.availability.can_enquire, false);
  assert.equal(publicAvailability({ availability: 'reserved' }).can_book_viewing, false);
  assert.ok(isPublic({ listing_status: 'published', archived_at: null }));
  assert.ok(!isPublic({ listing_status: 'published', archived_at: '2026-01-01' }));
  assert.ok(!isPublic({ listing_status: 'pending_approval' }));
});

test('listing input is validated', () => {
  assert.ok(cleanListingInput({}).errors.length);
  const { patch, errors } = cleanListingInput({ title: 'X', price: '1000', bedrooms: '3', amenities: 'Backup Power, pool', property_type: 'apartment', listing_status: 'published', company_id: 'evil' });
  assert.deepEqual(errors, []);
  assert.deepEqual(patch.amenities, ['backup_power', 'pool']);
  assert.equal(patch.listing_status, undefined);            // cannot self-publish via edit
  assert.equal(patch.company_id, undefined);
  assert.ok(cleanListingInput({ title: 'X', price: 1, images: ['http://insecure'] }).errors.length);
  assert.ok(cleanListingInput({ title: 'X', price: 1, bedrooms: 99 }).errors.length);
});

test('tenantDb scopes every operation and refuses child tables', async () => {
  const calls = [];
  const builder = new Proxy({}, { get: (_, k) => (...a) => { calls.push([k, ...a]); return builder; } });
  const base = { from: (t) => { calls.push(['from', t]); return builder; } };
  const t = tenantDb('C1', base);
  t.from('leads').select('*');
  t.from('leads').insert([{ name: 'x', company_id: 'C2' }]);
  t.from('leads').update({ name: 'y', company_id: 'C2' });
  t.from('leads').delete();
  assert.deepEqual(calls.filter((c) => c[0] === 'eq'), [['eq', 'company_id', 'C1'], ['eq', 'company_id', 'C1'], ['eq', 'company_id', 'C1']]);
  assert.deepEqual(calls.find((c) => c[0] === 'insert')[1], [{ name: 'x', company_id: 'C1' }]);
  assert.deepEqual(calls.find((c) => c[0] === 'update')[1], { name: 'y' });
  assert.throws(() => t.from('messages'), /parent/);
  assert.throws(() => tenantDb(null), /company/);
});

test('assistant filter extraction understands Ghanaian property requests', () => {
  const locs = [{ name: 'East Legon' }, { name: 'Osu' }];
  assert.deepEqual(ruleFilters('Find me a two-bedroom apartment in East Legon', locs), { beds: 2, type: 'apartment', q: 'East Legon' });
  const f = ruleFilters('I want to rent a furnished place under 7k with backup power', locs);
  assert.equal(f.purpose, 'rent');
  assert.equal(f.max_price, 7000);
  assert.equal(f.furnishing, 'furnished');
  assert.deepEqual(f.amenities, ['backup_power']);
  assert.equal(ruleFilters('house to buy between 1m and 2.5 million', locs).max_price, 2500000);
  assert.equal(ruleFilters('unfurnished flat', locs).furnishing, 'unfurnished');
});

test('price grounding check rejects invented amounts', () => {
  assert.ok(pricesGrounded('It costs GHS 6,000 per month.', [6000]));
  assert.ok(!pricesGrounded('It costs GHS 1 per month.', [6000]));
  assert.ok(pricesGrounded('No prices here.', []));
  assert.ok(pricesGrounded('Budget of GHS 7k works', [7000]));
});
