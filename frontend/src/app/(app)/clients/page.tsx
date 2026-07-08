'use client';
import { useEffect, useState } from 'react';
import { api, authStore } from '@/lib/api';
import { ScreenHead, Modal, timeAgo } from '@/components/Shell';

export default function Clients() {
  const [clients, setClients] = useState<any[]>([] as any[]);
  const [loaded, setLoaded] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [invited, setInvited] = useState<{ email: string; password: string } | null>(null);
  const [form, setForm] = useState({ name: '', phone: '', email: '' });
  const [busy, setBusy] = useState(false);
  const canInvite = ['owner', 'admin'].includes(authStore.getUser()?.role);

  const load = () => api.misc.clients().then((d) => { setClients(d); setLoaded(true); }).catch(() => setLoaded(true));
  useEffect(() => { load(); }, []);

  const invite = async (id: string) => {
    try {
      const res = await api.misc.invite(id);
      setInvited({ email: res.email, password: res.password });
      load();
    } catch (er: any) { alert(er.message); }
  };

  if (!loaded) return <div className="muted">Loading…</div>;

  return (
    <div>
      <ScreenHead id="" title="Clients">
        <button className="btn btn-green" onClick={() => setShowAdd(true)}>+ Client</button>
      </ScreenHead>

      <div className="card table-wrap" style={{ padding: 0 }}>
        <table className="table">
          <thead><tr><th>Name</th><th>Phone</th><th>Email</th><th>Portal access</th><th>Added</th><th></th></tr></thead>
          <tbody>
            {clients.map((c) => (
              <tr key={c.id}>
                <td style={{ fontWeight: 600 }}>{c.name}</td>
                <td>{c.phone || '—'}</td>
                <td>{c.email || '—'}</td>
                <td>
                  {c.user_id
                    ? <span className="tag t-green">invited — {c.user?.email}</span>
                    : <span className="tag t-amber">no portal login</span>}
                </td>
                <td>{timeAgo(c.created_at)}</td>
                <td>
                  {!c.user_id && canInvite && (
                    <button className="btn btn-sm btn-green" disabled={!c.email} title={c.email ? '' : 'Add an email first'} onClick={() => invite(c.id)}>
                      Invite to portal
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {clients.length === 0 && (
              <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 24 }}>No clients yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showAdd && (
        <Modal title="New client" onClose={() => setShowAdd(false)}>
          <form onSubmit={async (e) => {
            e.preventDefault(); setBusy(true);
            try {
              await api.misc.addClient(form);
              setShowAdd(false); setForm({ name: '', phone: '', email: '' }); load();
            } catch (er: any) { alert(er.message); } finally { setBusy(false); }
          }}>
            <div className="form-group"><label className="form-label">Name *</label>
              <input className="form-input" required value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} /></div>
            <div className="form-group"><label className="form-label">Phone</label>
              <input className="form-input" value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} /></div>
            <div className="form-group"><label className="form-label">Email</label>
              <input className="form-input" type="email" value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} placeholder="needed to invite them to the portal" /></div>
            <button className="btn btn-green btn-block" disabled={busy}>{busy ? 'Saving…' : 'Add client'}</button>
          </form>
        </Modal>
      )}

      {invited && (
        <Modal title="Client invited" onClose={() => setInvited(null)}>
          <div className="muted" style={{ marginBottom: 12 }}>Share these portal login details with the client. The password won&apos;t be shown again.</div>
          <div className="form-group"><label className="form-label">Email</label>
            <input className="form-input" readOnly value={invited.email} /></div>
          <div className="form-group"><label className="form-label">Temporary password</label>
            <input className="form-input" readOnly value={invited.password} /></div>
          <button className="btn btn-block" onClick={() => setInvited(null)}>Done</button>
        </Modal>
      )}
    </div>
  );
}
