'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { ScreenHead, Modal } from '@/components/Shell';

const ROLE_TAG: Record<string, string> = { owner: 't-green', admin: 't-green', agent: 't-amber', marketing: 't-amber' };

export default function Team() {
  const [team, setTeam] = useState<any[]>([] as any[]);
  const [loaded, setLoaded] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null);
  const [form, setForm] = useState({ name: '', email: '', phone: '', role: 'agent' });
  const [busy, setBusy] = useState(false);

  const load = () => api.misc.team().then((d) => { setTeam(d); setLoaded(true); }).catch(() => setLoaded(true));
  useEffect(() => { load(); }, []);

  if (!loaded) return <div className="muted">Loading…</div>;

  return (
    <div>
      <ScreenHead id="" title="Team">
        <button className="btn btn-green" onClick={() => setShowAdd(true)}>+ Team member</button>
      </ScreenHead>

      <div className="card table-wrap" style={{ padding: 0 }}>
        <table className="table">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th></tr></thead>
          <tbody>
            {team.map((t) => (
              <tr key={t.id}>
                <td style={{ fontWeight: 600 }}>{t.name}</td>
                <td>{t.email}</td>
                <td><span className={`tag ${ROLE_TAG[t.role] || 't-amber'}`} style={{ textTransform: 'capitalize' }}>{t.role}</span></td>
              </tr>
            ))}
            {team.length === 0 && (
              <tr><td colSpan={3} className="muted" style={{ textAlign: 'center', padding: 24 }}>No team members yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showAdd && (
        <Modal title="New team member" onClose={() => setShowAdd(false)}>
          <form onSubmit={async (e) => {
            e.preventDefault(); setBusy(true);
            try {
              const res = await api.misc.addTeamMember(form);
              setShowAdd(false); setCreated({ email: res.email, password: res.password });
              setForm({ name: '', email: '', phone: '', role: 'agent' }); load();
            } catch (er: any) { alert(er.message); } finally { setBusy(false); }
          }}>
            <div className="form-group"><label className="form-label">Name *</label>
              <input className="form-input" required value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} /></div>
            <div className="form-group"><label className="form-label">Email *</label>
              <input className="form-input" type="email" required value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} /></div>
            <div className="form-group"><label className="form-label">Phone</label>
              <input className="form-input" value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} /></div>
            <div className="form-group"><label className="form-label">Role *</label>
              <select className="form-select" required value={form.role} onChange={(e) => setForm((p) => ({ ...p, role: e.target.value }))}>
                <option value="agent">Agent</option>
                <option value="marketing">Marketing</option>
                <option value="admin">Admin</option>
                <option value="owner">Owner</option>
              </select></div>
            <button className="btn btn-green btn-block" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>
          </form>
        </Modal>
      )}

      {created && (
        <Modal title="Team member added" onClose={() => setCreated(null)}>
          <div className="muted" style={{ marginBottom: 12 }}>Share these login details with them. The password won&apos;t be shown again.</div>
          <div className="form-group"><label className="form-label">Email</label>
            <input className="form-input" readOnly value={created.email} /></div>
          <div className="form-group"><label className="form-label">Temporary password</label>
            <input className="form-input" readOnly value={created.password} /></div>
          <button className="btn btn-block" onClick={() => setCreated(null)}>Done</button>
        </Modal>
      )}
    </div>
  );
}
