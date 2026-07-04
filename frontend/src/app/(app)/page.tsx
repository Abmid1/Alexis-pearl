'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { ScreenHead, fmtGHS, timeAgo } from '@/components/Shell';

const KIND_ROUTE: Record<string, string> = { deal: '/deals', expense: '/finance', listing: '/marketing', payment: '/finance' };
const KIND_TAG: Record<string, string> = { deal: 't-green', expense: 't-amber', listing: 't-purple', payment: 't-blue' };

export default function CommandCenter() {
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState('');
  const router = useRouter();

  const load = () => api.dashboard().then(setData).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);

  if (err) return <div className="card" style={{ color: 'var(--red)' }}>Could not load: {err}</div>;
  if (!data) return <div className="muted">Loading…</div>;

  const k = data.kpis;
  const depts = [
    { key: 'sales',     label: 'Sales',     href: '/pipeline' },
    { key: 'inbox',     label: 'Inbox',     href: '/inbox' },
    { key: 'finance',   label: 'Finance',   href: '/finance' },
    { key: 'marketing', label: 'Marketing', href: '/marketing' },
  ];

  return (
    <div>
      <ScreenHead id="1a" title="Command Center" phase={1} />

      {/* Four live KPIs */}
      <div className="grid-kpi" style={{ marginBottom: 16 }}>
        <div className="kpi"><div className="label">New leads · month</div><div className="value">{k.newLeads}</div></div>
        <div className="kpi"><div className="label">Active deals</div><div className="value">{k.activeDeals}</div></div>
        <div className="kpi"><div className="label">Collected · month</div><div className="value" style={{ fontSize: 22 }}>{fmtGHS(k.collected)}</div></div>
        <div className={`kpi${k.overdueFollowUps > 0 ? ' alert' : ''}`}>
          <div className="label">Overdue follow-ups</div>
          <div className="value">{k.overdueFollowUps}</div>
        </div>
      </div>

      {/* AI daily brief */}
      <div className="card" style={{ marginBottom: 16, borderColor: 'rgba(52,211,153,0.25)', background: 'linear-gradient(135deg, rgba(52,211,153,0.05), transparent 55%)' }}>
        <div className="row" style={{ marginBottom: 8 }}>
          <span style={{ fontSize: 15 }}>🤖</span>
          <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--green-bright)' }}>AI daily brief</span>
        </div>
        <div style={{ fontSize: 13.5, lineHeight: 1.7, color: 'var(--text-secondary)' }}>{data.brief}</div>
      </div>

      {/* Approvals queue (owner/admin only — API already filters) */}
      {data.approvals?.length > 0 && (
        <>
          <div className="section-title">Awaiting your approval ({data.approvals.length})</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
            {data.approvals.map((a: any) => (
              <button key={`${a.kind}-${a.id}`} className="card spread" style={{ cursor: 'pointer', textAlign: 'left', width: '100%' }}
                onClick={() => router.push(KIND_ROUTE[a.kind] || '/')}>
                <div className="row" style={{ minWidth: 0 }}>
                  <span className={`tag ${KIND_TAG[a.kind]}`}>{a.kind}</span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.label}</div>
                    <div className="muted">{a.detail}</div>
                  </div>
                </div>
                <div className="row" style={{ flexShrink: 0 }}>
                  <span className="muted">{timeAgo(a.created_at)}</span>
                  <span style={{ color: 'var(--green-bright)', fontWeight: 700 }}>Review →</span>
                </div>
              </button>
            ))}
          </div>
        </>
      )}

      {/* Departments at a glance */}
      <div className="section-title">Departments at a glance</div>
      <div className="grid-kpi">
        {depts.map((d) => {
          const dept = data.departments[d.key];
          return (
            <button key={d.key} className="kpi" style={{ cursor: 'pointer', textAlign: 'left', border: dept.alert > 0 ? '1px solid rgba(251,191,36,0.35)' : undefined }}
              onClick={() => router.push(d.href)}>
              <div className="spread">
                <div className="label" style={{ marginBottom: 0 }}>{d.label}</div>
                {dept.alert > 0
                  ? <span className="tag t-amber">{dept.alert}</span>
                  : <span className="tag t-green">OK</span>}
              </div>
              <div className="muted" style={{ marginTop: 8 }}>{dept.note}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
