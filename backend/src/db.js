import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;

if (!url || !key) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY — copy .env.example to .env and fill it in.');
  process.exit(1);
}

export const db = createClient(url, key, { auth: { persistSession: false } });
