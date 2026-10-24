import { db } from '../db.js';

/**
 * Round-robin auto-assignment (1b): new leads get exactly one owner immediately.
 * Agents and the cursor are per company.
 */
export async function nextAgent(companyId) {
  const { data: agents } = await db
    .from('users')
    .select('id,name')
    .eq('company_id', companyId)
    .eq('role', 'agent')
    .eq('active', true)
    .order('created_at');
  if (!agents?.length) {
    // fall back to the company owner so a lead is never ownerless
    const { data: owner } = await db.from('users').select('id,name')
      .eq('company_id', companyId).eq('role', 'owner').limit(1).maybeSingle();
    return owner;
  }
  const { data: company } = await db.from('companies').select('settings').eq('id', companyId).single();
  const settings = company?.settings || {};
  const cursor = Number(settings.rr_cursor ?? 0);
  const agent = agents[cursor % agents.length];
  await db.from('companies').update({ settings: { ...settings, rr_cursor: (cursor + 1) % agents.length } }).eq('id', companyId);
  return agent;
}
