'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { ScreenHead, timeAgo } from '@/components/Shell';

const ACTION_TAG: Record<string, string> = {
  approved: 't-green', rejected: 't-red', created: 't-blue', updated: 't-amber',
  deleted: 't-red', sent: 't-purple', ai_sent: 't-purple',
};

export default function Audit() {
  const [rows, setRows] = useState<any[]>([]);
  const [outbox, setOutbox] = useState<any[]>([]);
  const [tab, setTab] = useState<'audit' | 'outbox'>('audit');

  useEffect(() => {
    api.misc.audit().then(setRows).catch(() => {});
    api.misc.outbox().then(setOutbox).catch(() => {});
  }, []);

  return (
    <div>
      <ScreenHead id="" title="Audit Log" />
      <div className="muted" style={{ marginBottom: 12 }}>Who changed what, when — critical once approvals are digital.</div>

      <div className="row" style={{ gap: 6, marginBottom: 14 }}>
        <button className={`btn btn-sm ${tab === 'audit' ? 'btn-green' : ''}`} onClick={() => setTab('audit')}>Changes ({rows.length})</button>
        <button className={`btn btn-sm ${tab === 'outbox' ? 'btn-green' : ''}`} onClick={() => setTab('outbox')}>Outbox ({outbox.length})</button>
      </div>

      {tab === 'audit' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {rows.map((r) => (
            <div key={r.id} className="card spread" style={{ padding: '10px 14px' }}>
              <div className="row" style={{ minWidth: 0 }}>
                <span className={`tag ${ACTION_TAG[r.action] || 't-gray'}`}>{r.action.replace(/_/g, ' ')}</span>
                <div style={{ minWidth: 0 }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{r.user_name}</span>
                  <span className="muted"> · {r.entity}</span>
                  {r.detail && Object.keys(r.detail).length > 0 && (
                    <span className="muted" style={{ display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {Object.entries(r.detail).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ')}
                    </span>
                  )}
                </div>
              </div>
              <span className="muted" style={{ flexShrink: 0 }}>{timeAgo(r.created_at)}</span>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div className="muted" style={{ marginBottom: 4 }}>
            Every outbound WhatsApp/SMS/email goes through the integration seam. Without live credentials they're recorded as <span className="tag t-amber">simulated</span> — connect the WhatsApp Business API and they switch to <span className="tag t-green">sent</span>.
          </div>
          {outbox.map((o) => (
            <div key={o.id} className="card" style={{ padding: '10px 14px' }}>
              <div className="spread" style={{ marginBottom: 4 }}>
                <div className="row">
                  <span className="tag t-blue">{o.channel}</span>
                  <span style={{ fontSize: 12.5, fontWeight: 600 }}>{o.to_addr}</span>
                  <span className={`tag ${o.status === 'sent' ? 't-green' : o.status === 'failed' ? 't-red' : 't-amber'}`}>{o.status}</span>
                  <span className="tag t-gray">{o.ref}</span>
                </div>
                <span className="muted">{timeAgo(o.created_at)}</span>
              </div>
              <div className="muted" style={{ lineHeight: 1.5 }}>{o.body.slice(0, 180)}{o.body.length > 180 ? '…' : ''}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
