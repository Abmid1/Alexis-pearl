'use client';
import { useEffect, useState } from 'react';
import { api, authStore } from '@/lib/api';
import { ScreenHead, fmtGHS, timeAgo } from '@/components/Shell';

export default function Reports() {
  const user = typeof window !== 'undefined' ? authStore.getUser() : null;
  const isManager = ['owner', 'admin'].includes(user?.role);
  const [r, setR] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [sendMsg, setSendMsg] = useState('');

  const load = () => {
    api.reports.get().then(setR).catch(() => {});
    api.reports.history().then(setHistory).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  if (!r) return <div className="muted">Loading…</div>;

  const funnelMax = Math.max(...Object.values(r.funnel).map(Number), 1);
  const sourceMax = Math.max(...Object.values(r.sources || {}).map(Number), 1);

  return (
    <div>
      <ScreenHead id="1h" title="Weekly Report" phase={2}>
        {isManager && (
          <button className="btn btn-green" onClick={async () => {
            const run = await api.reports.sendNow();
            setSendMsg(`Sent to ${run.sent_to?.length || 0} recipients`);
            load();
          }}>📤 Send digest now</button>
        )}
      </ScreenHead>
      <div className="muted" style={{ marginBottom: 14 }}>
        Compiles itself from live data and auto-sends every Monday 7am (WhatsApp + email) to all department heads.
        {sendMsg && <strong style={{ color: 'var(--green-bright)' }}> {sendMsg}.</strong>}
      </div>

      <div className="grid-kpi" style={{ marginBottom: 16 }}>
        <div className="kpi"><div className="label">New leads · week</div><div className="value">{r.newLeadsThisWeek}</div></div>
        <div className="kpi"><div className="label">Conversion rate</div><div className="value">{r.conversionRate}%</div></div>
        <div className="kpi"><div className="label">Revenue · week</div><div className="value" style={{ fontSize: 21 }}>{fmtGHS(r.weeklyRevenue)}</div></div>
        <div className="kpi"><div className="label">Avg response time</div><div className="value">{r.avgResponseMins ?? '—'}<span style={{ fontSize: 14 }}> min</span></div></div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12 }}>
        {/* Funnel */}
        <div className="card">
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>Lead → viewing funnel</div>
          {Object.entries(r.funnel).map(([stage, n]: any) => (
            <div key={stage} style={{ marginBottom: 9 }}>
              <div className="spread" style={{ marginBottom: 3 }}>
                <span style={{ fontSize: 12, textTransform: 'capitalize' }}>{stage}</span>
                <span style={{ fontSize: 12, fontWeight: 700 }}>{n}</span>
              </div>
              <div className="progress" style={{ height: 7 }}><div style={{ width: `${(Number(n) / funnelMax) * 100}%` }} /></div>
            </div>
          ))}
        </div>

        {/* Leaderboard */}
        <div className="card">
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>Agent leaderboard</div>
          {r.leaderboard.map((a: any, i: number) => (
            <div key={a.agentId} className="spread" style={{ padding: '8px 0', borderBottom: '1px solid var(--border-subtle)' }}>
              <div className="row">
                <span style={{ fontSize: 15 }}>{['🥇', '🥈', '🥉'][i] || '·'}</span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{a.agent}</div>
                  <div className="muted">{a.leads} leads · {a.won} won</div>
                </div>
              </div>
              <strong style={{ color: 'var(--green-bright)' }}>{fmtGHS(a.dealsValue)}</strong>
            </div>
          ))}
        </div>

        {/* Sources */}
        <div className="card">
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>Lead sources · this week</div>
          {Object.keys(r.sources || {}).length === 0 && <div className="muted">No new leads this week yet.</div>}
          {Object.entries(r.sources || {}).sort((a: any, b: any) => b[1] - a[1]).map(([s, n]: any) => (
            <div key={s} style={{ marginBottom: 9 }}>
              <div className="spread" style={{ marginBottom: 3 }}>
                <span style={{ fontSize: 12 }}>{s}</span><span style={{ fontSize: 12, fontWeight: 700 }}>{n}</span>
              </div>
              <div className="progress" style={{ height: 7 }}><div style={{ width: `${(Number(n) / sourceMax) * 100}%` }} /></div>
            </div>
          ))}
        </div>
      </div>

      {isManager && history.length > 0 && (
        <>
          <div className="section-title">Sent digests</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {history.map((h) => (
              <div key={h.id} className="card spread">
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>Week of {h.week_start}</div>
                  <div className="muted">{(h.sent_to || []).join(', ') || 'no recipients'}</div>
                </div>
                <span className="muted">{timeAgo(h.created_at)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
