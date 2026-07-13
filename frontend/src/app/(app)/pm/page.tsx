'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { ScreenHead, Modal, fmtGHS, timeAgo } from '@/components/Shell';
import { I } from '@/components/Icons';

const TICKET_TAG: Record<string, string> = { open: 't-red', in_progress: 't-amber', resolved: 't-green' };

export default function PM() {
  const [data, setData] = useState<any>(null);
  const [clients, setClients] = useState<any[]>([]);
  const [props, setProps] = useState<any[]>([]);
  const [showLease, setShowLease] = useState(false);
  const [showTicket, setShowTicket] = useState(false);
  const [lease, setLease] = useState({ property_id: '', client_id: '', rent_amount: '', start_date: '', end_date: '' });
  const [ticket, setTicket] = useState({ property_id: '', title: '', description: '' });
  const [busy, setBusy] = useState(false);

  const load = () => {
    api.pm.overview().then(setData).catch(() => {});
    api.misc.clients().then(setClients).catch(() => {});
    api.marketing.listings().then(setProps).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  if (!data) return <div className="muted">Loading…</div>;

  return (
    <div>
      <ScreenHead id="1j" title="Property Management" phase={3}>
        <button className="btn" onClick={() => setShowTicket(true)}>+ Ticket</button>
        <button className="btn btn-green" onClick={() => setShowLease(true)}>+ Lease</button>
      </ScreenHead>

      {!data.active ? (
        <div className="card" style={{ textAlign: 'center', padding: 36 }}>
          <div style={{ marginBottom: 10 }}><I name="building" size={32} style={{ color: 'var(--text-muted)' }} /></div>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Dormant — designed in from day one</div>
          <div className="muted" style={{ maxWidth: 420, margin: '0 auto 16px' }}>
            You manage zero properties today. The moment you take on the first one, add its lease here and the module comes alive: rent roll, arrears, renewal alerts, maintenance tickets, document vault.
          </div>
          <button className="btn btn-green" onClick={() => setShowLease(true)}>Add first managed property</button>
        </div>
      ) : (
        <>
          <div className="section-title" style={{ marginTop: 0 }}>Rent roll</div>
          <div className="card table-wrap" style={{ padding: 0, marginBottom: 18 }}>
            <table className="table">
              <thead><tr><th>Property / unit</th><th>Tenant</th><th>Rent</th><th>This month</th><th>Lease ends</th><th></th></tr></thead>
              <tbody>
                {data.rentRoll.map((l: any) => (
                  <tr key={l.id}>
                    <td style={{ fontWeight: 600 }}>{l.property?.title}{l.unit ? ` · ${l.unit.name}` : ''}</td>
                    <td>{l.client?.name}</td>
                    <td>{fmtGHS(l.rent_amount)}/mo</td>
                    <td>{l.arrears
                      ? <span className="tag t-red">arrears — {fmtGHS(Number(l.rent_amount) - l.paidThisMonth)} short</span>
                      : <span className="tag t-green">paid</span>}</td>
                    <td>
                      {l.end_date}
                      {l.renewalAlert && <span className="tag t-amber" style={{ marginLeft: 6 }}>renew in {l.daysToEnd}d</span>}
                    </td>
                    <td><button className="btn btn-sm btn-green" onClick={async () => { await api.pm.recordRent(l.id, {}); load(); }}>Record rent</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="section-title">Maintenance tickets — every call becomes a logged ticket with an owner</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {data.tickets.map((t: any) => (
              <div key={t.id} className="card spread" style={{ flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{t.title}</div>
                  <div className="muted">{t.property?.title} · {t.client?.name || 'internal'} · owner: {t.owner?.name} · {timeAgo(t.created_at)}</div>
                  {t.description && <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>{t.description}</div>}
                </div>
                <div className="row">
                  <span className={`tag ${TICKET_TAG[t.status]}`}>{t.status.replace('_', ' ')}</span>
                  {t.status !== 'resolved' && (
                    <button className="btn btn-sm" onClick={async () => {
                      await api.pm.updateTicket(t.id, { status: t.status === 'open' ? 'in_progress' : 'resolved' });
                      load();
                    }}>{t.status === 'open' ? 'Start' : 'Resolve'}</button>
                  )}
                </div>
              </div>
            ))}
            {data.tickets.length === 0 && <div className="card muted" style={{ textAlign: 'center' }}>No tickets.</div>}
          </div>
        </>
      )}

      {showLease && (
        <Modal title="New lease" onClose={() => setShowLease(false)}>
          <form onSubmit={async (e) => {
            e.preventDefault(); setBusy(true);
            try {
              await api.pm.addLease({ ...lease, rent_amount: Number(lease.rent_amount) });
              setShowLease(false); load();
            } catch (er: any) { alert(er.message); } finally { setBusy(false); }
          }}>
            <div className="form-group"><label className="form-label">Property *</label>
              <select className="form-select" required value={lease.property_id} onChange={(e) => setLease((p) => ({ ...p, property_id: e.target.value }))}>
                <option value="">— select —</option>
                {props.map((pr) => <option key={pr.id} value={pr.id}>{pr.title}</option>)}
              </select></div>
            <div className="form-group"><label className="form-label">Tenant *</label>
              <select className="form-select" required value={lease.client_id} onChange={(e) => setLease((p) => ({ ...p, client_id: e.target.value }))}>
                <option value="">— select —</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select></div>
            <div className="form-group"><label className="form-label">Monthly rent (GHS) *</label>
              <input className="form-input" type="number" required value={lease.rent_amount} onChange={(e) => setLease((p) => ({ ...p, rent_amount: e.target.value }))} /></div>
            <div className="row" style={{ gap: 10 }}>
              <div className="form-group" style={{ flex: 1 }}><label className="form-label">Start *</label>
                <input className="form-input" type="date" required value={lease.start_date} onChange={(e) => setLease((p) => ({ ...p, start_date: e.target.value }))} /></div>
              <div className="form-group" style={{ flex: 1 }}><label className="form-label">End *</label>
                <input className="form-input" type="date" required value={lease.end_date} onChange={(e) => setLease((p) => ({ ...p, end_date: e.target.value }))} /></div>
            </div>
            <button className="btn btn-green btn-block" disabled={busy}>{busy ? 'Saving…' : 'Create lease (activates module)'}</button>
          </form>
        </Modal>
      )}

      {showTicket && (
        <Modal title="New maintenance ticket" onClose={() => setShowTicket(false)}>
          <form onSubmit={async (e) => {
            e.preventDefault(); setBusy(true);
            try {
              await api.pm.addTicket({ ...ticket, property_id: ticket.property_id || undefined });
              setShowTicket(false); setTicket({ property_id: '', title: '', description: '' }); load();
            } finally { setBusy(false); }
          }}>
            <div className="form-group"><label className="form-label">Property</label>
              <select className="form-select" value={ticket.property_id} onChange={(e) => setTicket((p) => ({ ...p, property_id: e.target.value }))}>
                <option value="">— select —</option>
                {props.map((pr) => <option key={pr.id} value={pr.id}>{pr.title}</option>)}
              </select></div>
            <div className="form-group"><label className="form-label">Issue *</label>
              <input className="form-input" required value={ticket.title} onChange={(e) => setTicket((p) => ({ ...p, title: e.target.value }))} placeholder="e.g. AC not cooling" /></div>
            <div className="form-group"><label className="form-label">Details</label>
              <textarea className="form-input" rows={3} value={ticket.description} onChange={(e) => setTicket((p) => ({ ...p, description: e.target.value }))} /></div>
            <button className="btn btn-green btn-block" disabled={busy}>{busy ? 'Logging…' : 'Log ticket'}</button>
          </form>
        </Modal>
      )}
    </div>
  );
}
