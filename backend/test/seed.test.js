import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fake } from './helpers/setup.js';

test('demo seed stamps every business record with a company and keeps companies apart', async () => {
  fake.reset();
  const log = console.log; console.log = () => {};
  try { const { run } = await import('../scripts/seed.js'); await run(); } finally { console.log = log; }
  const [ap, sh] = ['alexis-pearl', 'sunrise-homes'].map((slug) => fake.tables.companies.find((c) => c.slug === slug));
  assert.ok(ap && sh);
  for (const t of ['users', 'clients', 'leads', 'properties', 'deals', 'payment_plans', 'invoices', 'conversations', 'documents', 'leases', 'tickets']) {
    assert.ok(fake.tables[t].length, t);
    assert.ok(fake.tables[t].every((r) => r.company_id === ap.id || r.company_id === sh.id), `${t} rows missing company`);
  }
  assert.equal(fake.tables.properties.filter((p) => p.company_id === sh.id).length, 2);
  assert.ok(!fake.tables.documents.some((d) => d.is_public && d.client_id), 'client documents are never public');
  assert.ok(!fake.tables.documents.find((d) => d.title === 'Company FAQ').is_public, 'title-verification claims are not exposed to customers');
});
