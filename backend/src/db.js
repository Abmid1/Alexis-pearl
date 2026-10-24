import { createClient } from '@supabase/supabase-js';

/**
 * Supabase client (service key — server only, never sent to the browser).
 * Tests inject an in-memory stand-in through globalThis.__BILT_TEST_DB__.
 */
function make() {
  if (globalThis.__BILT_TEST_DB__) return globalThis.__BILT_TEST_DB__;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY — copy .env.example to .env and fill it in.');
    process.exit(1);
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

export const db = make();
