import { db } from '../db.js';

/** Round-robin auto-assignment (1b): new leads get exactly one owner immediately. */
export async function nextAgent() {
  const { data: agents } = await db
    .from('users')
    .select('id,name')
    .eq('role', 'agent')
    .eq('active', true)
    .order('created_at');
  if (!agents?.length) {
    // fall back to owner so a lead is never ownerless
    const { data: owner } = await db.from('users').select('id,name').eq('role', 'owner').limit(1).single();
    return owner;
  }
  const { data: s } = await db.from('settings').select('value').eq('key', 'rr_cursor').single();
  const cursor = Number(s?.value ?? 0);
  const agent = agents[cursor % agents.length];
  await db.from('settings').update({ value: JSON.stringify((cursor + 1) % agents.length) }).eq('key', 'rr_cursor');
  return agent;
}
