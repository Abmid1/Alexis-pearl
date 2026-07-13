'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { ScreenHead, Modal, fmtGHS, timeAgo } from '@/components/Shell';
import { I } from '@/components/Icons';

const STAGES = [
  { key: 'new',       label: 'New' },
  { key: 'contacted', label: 'Contacted' },
  { key: 'viewing',   label: 'Viewing' },
  { key: 'closing',   label: 'Closing' },
];
const SOURCES = ['WhatsApp', 'Referral', 'Call-in', 'Walk-in', 'TikTok', 'Instagram', 'X', 'Website'];
const SOURCE_TAG: Record<string, string> = { WhatsApp: 't-green', TikTok: 't-purple', Instagram: 't-purple', X: 't-blue', Website: 't-blue', Referral: 't-amber', 'Call-in': 't-gray', 'Walk-in': 't-gray', SMS: 't-gray', Email: 't-blue' };

export default function Pipeline() {
  const [leads, setLeads] = useState<any[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [drag, setDrag] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', source: 'WhatsApp', phone: '', interest: '', budget: '' });
  const [busy, setBusy] = useState(false);

  const load = () => api.leads.list().then(setLeads).catch(() => {});
  useEffect(() => { load(); }, []);

  const move = async (id: string, stage: string) => {
    setLeads((p) => p.map((l) => (l.id === id ? { ...l, stage, overdue: false } : l)));
    await api.leads.update(id, { stage }).catch(() => load());
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    try {
      await api.leads.create({ ...form, budget: Number(form.budget) || 0 });
      setShowAdd(false);
      setForm({ name: '', source: 'WhatsApp', phone: '', interest: '', budget: '' });
      load();
    } finally { setBusy(false); }
  };

  const followUp = async (id: string) => {
    await api.leads.followedUp(id, 3).catch(() => {});
    load();
  };

  const overdueCount = leads.filter((l) => l.overdue).length;

  return (
    <div>
      <ScreenHead id="1b" title="Sales Pipeline" phase={1}>
        <button className="btn btn-green" onClick={() => setShowAdd(true)}>+ New lead</button>
      </ScreenHead>

      <div className="muted" style={{ marginBottom: 14 }}>
        Auto-captured leads land here from WhatsApp, socials and the website chatbot — already assigned.
        Calls, referrals and walk-ins: tap <strong>+ New lead</strong> (name + source is enough).
        {overdueCount > 0 && <span style={{ color: 'var(--red)', fontWeight: 700 }}> {overdueCount} follow-up{overdueCount > 1 ? 's' : ''} overdue.</span>}
      </div>

      <div className="kanban">
        {STAGES.map((s) => {
          const col = leads.filter((l) => l.stage === s.key);
          return (
            <div key={s.key} className="kb-col"
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => { if (drag) { move(drag, s.key); setDrag(null); } }}>
              <h3><span>{s.label}</span><span className="muted">{col.length}</span></h3>
              {col.map((l) => (
                <div key={l.id} className={`kb-card${l.overdue ? ' overdue' : ''}`} draggable
                  onDragStart={() => setDrag(l.id)}>
                  <div className="spread" style={{ marginBottom: 6 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700 }}>{l.name}</div>
                    <span className={`tag ${SOURCE_TAG[l.source] || 't-gray'}`}>{l.source}</span>
                  </div>
                  {l.interest && <div className="muted" style={{ marginBottom: 4 }}>{l.interest}</div>}
                  {Number(l.budget) > 0 && <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--green-bright)', marginBottom: 6 }}>{fmtGHS(l.budget)}</div>}
                  <div className="spread">
                    <span className="muted row" style={{ fontSize: 11, gap: 4 }}><I name="user" size={11} /> {l.owner?.name || 'Unassigned'}</span>
                    {l.overdue
                      ? <button className="btn btn-sm btn-red" onClick={() => followUp(l.id)} style={{ animation: 'pulse 2s infinite' }}>Overdue — done?</button>
                      : l.next_follow_up && <span className="muted" style={{ fontSize: 11 }}>next: {new Date(l.next_follow_up).toLocaleDateString()}</span>}
                  </div>
                  {/* mobile: tap to advance since drag is awkward on touch */}
                  <div className="row" style={{ marginTop: 8, gap: 6 }}>
                    {STAGES.filter((x) => x.key !== l.stage).slice(0, 3).map((x) => (
                      <button key={x.key} className="btn btn-sm" style={{ fontSize: 10.5, minHeight: 26, padding: '3px 8px' }} onClick={() => move(l.id, x.key)}><I name="chevronRight" size={11} /> {x.label}</button>
                    ))}
                  </div>
                </div>
              ))}
              {col.length === 0 && <div className="muted" style={{ textAlign: 'center', padding: '18px 0' }}>Empty</div>}
            </div>
          );
        })}
      </div>

      {showAdd && (
        <Modal title="New lead (manual entry)" onClose={() => setShowAdd(false)}>
          <form onSubmit={add}>
            <div className="form-group">
              <label className="form-label">Name *</label>
              <input className="form-input" required value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="Who called / walked in?" />
            </div>
            <div className="form-group">
              <label className="form-label">Source *</label>
              <select className="form-select" value={form.source} onChange={(e) => setForm((p) => ({ ...p, source: e.target.value }))}>
                {SOURCES.map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Phone <span className="muted">(fill later if unknown)</span></label>
              <input className="form-input" value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} placeholder="+233…" />
            </div>
            <div className="form-group">
              <label className="form-label">Interested in</label>
              <input className="form-input" value={form.interest} onChange={(e) => setForm((p) => ({ ...p, interest: e.target.value }))} placeholder="e.g. 3-bed East Legon" />
            </div>
            <div className="form-group">
              <label className="form-label">Budget (GHS)</label>
              <input className="form-input" type="number" value={form.budget} onChange={(e) => setForm((p) => ({ ...p, budget: e.target.value }))} />
            </div>
            <div className="muted" style={{ marginBottom: 12 }}>The lead is auto-assigned to the next agent (round-robin) with a 24-hour follow-up timer.</div>
            <button className="btn btn-green btn-block" disabled={busy}>{busy ? 'Saving…' : 'Add lead'}</button>
          </form>
        </Modal>
      )}
    </div>
  );
}
