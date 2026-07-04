import { db } from '../db.js';
import { sendMessage } from './integrations.js';

/** 1h — compiles the weekly report from live data. Nobody builds a spreadsheet. */
export async function compileWeeklyReport() {
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();

  const [{ data: leads }, { data: allLeads }, { data: deals }, { data: payments }, { data: msgs }, { data: agents }] = await Promise.all([
    db.from('leads').select('id,source,stage,owner_id,created_at').gte('created_at', weekAgo),
    db.from('leads').select('id,source,stage,owner_id'),
    db.from('deals').select('id,agent_id,sale_price,status,created_at'),
    db.from('payments').select('amount,created_at,status').eq('status', 'approved').gte('created_at', weekAgo),
    db.from('messages').select('conversation_id,direction,created_at').gte('created_at', weekAgo).eq('is_draft', false).order('created_at'),
    db.from('users').select('id,name').in('role', ['agent', 'owner', 'admin']),
  ]);

  // funnel (all time, current stages)
  const funnel = { new: 0, contacted: 0, viewing: 0, closing: 0, won: 0 };
  (allLeads || []).forEach((l) => { if (funnel[l.stage] !== undefined) funnel[l.stage]++; });
  const totalLeads = (allLeads || []).length;
  const conversionRate = totalLeads ? +((funnel.won / totalLeads) * 100).toFixed(1) : 0;

  const weeklyRevenue = (payments || []).reduce((s, p) => s + Number(p.amount), 0);

  // avg response time: gap between an inbound message and the next outbound in the same conversation
  const byConv = {};
  (msgs || []).forEach((m) => { (byConv[m.conversation_id] = byConv[m.conversation_id] || []).push(m); });
  const gaps = [];
  Object.values(byConv).forEach((list) => {
    for (let i = 0; i < list.length - 1; i++) {
      if (list[i].direction === 'in' && list[i + 1].direction === 'out') {
        gaps.push(new Date(list[i + 1].created_at) - new Date(list[i].created_at));
      }
    }
  });
  const avgResponseMins = gaps.length ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length / 60000) : null;

  // agent leaderboard
  const leaderboard = (agents || []).map((a) => {
    const myLeads = (allLeads || []).filter((l) => l.owner_id === a.id);
    const myDeals = (deals || []).filter((d) => d.agent_id === a.id && ['approved', 'closed'].includes(d.status));
    return {
      agentId: a.id, agent: a.name,
      leads: myLeads.length,
      won: myLeads.filter((l) => l.stage === 'won').length,
      dealsValue: myDeals.reduce((s, d) => s + Number(d.sale_price), 0),
    };
  }).sort((a, b) => b.dealsValue - a.dealsValue);

  // lead source breakdown (this week)
  const sources = {};
  (leads || []).forEach((l) => (sources[l.source] = (sources[l.source] || 0) + 1));

  return {
    weekStart: new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10),
    newLeadsThisWeek: (leads || []).length,
    funnel, conversionRate, weeklyRevenue, avgResponseMins,
    leaderboard, sources,
  };
}

/** Auto-sends every Monday (cron) — WhatsApp + email to all department heads. */
export async function sendWeeklyReport() {
  const report = await compileWeeklyReport();
  const summary =
    `📊 Alexis Pearl — weekly digest (w/c ${report.weekStart})\n` +
    `New leads: ${report.newLeadsThisWeek} · Conversion: ${report.conversionRate}% · Revenue: GHS ${report.weeklyRevenue.toLocaleString()}\n` +
    `Avg response time: ${report.avgResponseMins ?? '—'} min\n` +
    `Top agent: ${report.leaderboard[0]?.agent || '—'} (GHS ${(report.leaderboard[0]?.dealsValue || 0).toLocaleString()})\n` +
    `Sources: ${Object.entries(report.sources).map(([s, n]) => `${s} ${n}`).join(', ') || '—'}`;

  const { data: heads } = await db.from('users').select('name,email,phone').in('role', ['owner', 'admin', 'agent', 'marketing']).eq('active', true);
  const sentTo = [];
  for (const h of heads || []) {
    if (h.phone) { await sendMessage('whatsapp', h.phone, summary, 'report'); sentTo.push(`${h.name} (whatsapp)`); }
    if (h.email) { await sendMessage('email', h.email, summary, 'report'); sentTo.push(`${h.name} (email)`); }
  }
  const { data: run } = await db.from('report_runs').insert({
    week_start: report.weekStart, payload: report, sent_to: sentTo,
  }).select().single();
  return run;
}
