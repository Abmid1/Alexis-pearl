import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { startServer, client, seed, fake } from './helpers/setup.js';

/** Paystack: an installment is paid only after a signed webhook AND server-side verification. */
let srv; let call; let s; let plan; let inst; let realFetch; let paystackTx;

before(async () => { srv = await startServer(); call = client(srv.base); });
after(() => srv.close());
beforeEach(async () => {
  s = await seed();
  process.env.PAYSTACK_SECRET_KEY = 'sk_test_secret';
  plan = (await call('POST', '/api/plans', { token: s.t.aOwner, body: { client_id: s.aClient.id, total: 3000, installment_count: 3 } })).body;
  inst = plan.installments[0];
  paystackTx = { status: 'success', currency: 'GHS', amount: Math.round(Number(inst.amount) * 100), metadata: { installment_id: inst.id, company_id: s.A.id } };
  realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (String(url).startsWith('https://api.paystack.co/transaction/verify/')) {
      return new Response(JSON.stringify({ status: true, data: paystackTx }), { status: 200 });
    }
    return realFetch(url, opts);
  };
});
afterEach(() => { globalThis.fetch = realFetch; delete process.env.PAYSTACK_SECRET_KEY; });

function webhook(body, secret = 'sk_test_secret') {
  const raw = JSON.stringify(body);
  return fetch(`${srv.base}/api/webhooks/paystack`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-paystack-signature': createHmac('sha512', secret).update(raw).digest('hex') },
    body: raw,
  });
}
const paid = () => fake.tables.installments.find((i) => i.id === inst.id).status === 'paid';

test('forged webhook (wrong signature) is rejected and nothing is paid', async () => {
  const r = await webhook({ event: 'charge.success', data: { reference: 'ref_1' } }, 'attacker-key');
  assert.equal(r.status, 401);
  assert.ok(!paid());
});

test('valid webhook + verified transaction marks the installment paid exactly once', async () => {
  assert.equal((await webhook({ event: 'charge.success', data: { reference: 'ref_ok_1' } })).status, 200);
  assert.ok(paid());
  await webhook({ event: 'charge.success', data: { reference: 'ref_ok_1' } });   // Paystack retries
  const pays = fake.tables.payments.filter((p) => p.provider_reference === 'ref_ok_1');
  assert.equal(pays.length, 1);
  assert.equal(pays[0].company_id, s.A.id);
});

test('amount, currency, status or company mismatches never mark anything paid', async () => {
  for (const tweak of [{ amount: 100 }, { currency: 'USD' }, { status: 'failed' }, { metadata: { installment_id: inst.id, company_id: s.B.id } }]) {
    paystackTx = { ...paystackTx, ...tweak };
    await webhook({ event: 'charge.success', data: { reference: `ref_${Object.keys(tweak)[0]}` } });
    assert.ok(!paid(), `should not pay with ${JSON.stringify(tweak)}`);
    paystackTx = { status: 'success', currency: 'GHS', amount: Math.round(Number(inst.amount) * 100), metadata: { installment_id: inst.id, company_id: s.A.id } };
  }
});

test('other events are acknowledged and ignored', async () => {
  assert.equal((await webhook({ event: 'transfer.success', data: {} })).status, 200);
  assert.ok(!paid());
});
