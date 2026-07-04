'use client';
import { useEffect, useState } from 'react';
import { api, authStore } from '@/lib/api';
import { ScreenHead, Modal, fmtGHS } from '@/components/Shell';

function fileToDataUrl(f: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = rej; r.readAsDataURL(f);
  });
}

export default function Plans() {
  const user = typeof window !== 'undefined' ? authStore.getUser() : null;
  const isManager = ['owner', 'admin'].includes(user?.role);
  const [plans, setPlans] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [deals, setDeals] = useState<any[]>([]);
  const [units, setUnits] = useState<any[]>([]);
  const [recordFor, setRecordFor] = useState<any>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [trackFor, setTrackFor] = useState<any>(null);
  const [pay, setPay] = useState({ amount: '', method: 'momo', receipt_url: '' });
  const [create, setCreate] = useState({ client_id: '', deal_id: '', unit_id: '', total: '', installment_count: '18', start_date: '' });
  const [track, setTrack] = useState({ completion_pct: '', handover_date: '' });
  const [remindResult, setRemindResult] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    api.plans.list().then(setPlans).catch(() => {});
    api.misc.clients().then(setClients).catch(() => {});
    api.deals.list().then(setDeals).catch(() => {});
    api.misc.units().then(setUnits).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  return (
    <div>
      <ScreenHead id="1g" title="Payment Plans" phase={2}>
        <button className="btn" onClick={async () => { const r = await api.plans.sendReminders(); setRemindResult(r.sent); }}>
          🔔 Send reminders{remindResult !== null ? ` — ${remindResult} sent` : ''}
        </button>
        {isManager && <button className="btn btn-green" onClick={() => setShowCreate(true)}>+ New plan</button>}
      </ScreenHead>

      <div className="muted" style={{ marginBottom: 14 }}>
        WhatsApp reminders also go out automatically every morning for installments due within 3 days.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
        {plans.map((p) => {
          const pct = Math.round((p.paidAmount / Number(p.total)) * 100);
          const overdue = p.overdueCount > 0;
          return (
            <div key={p.id} className="card" style={{ borderColor: overdue ? 'rgba(248,113,113,0.45)' : undefined }}>
              <div className="spread" style={{ marginBottom: 4 }}>
                <div style={{ fontWeight: 700 }}>{p.client?.name}</div>
                {overdue ? <span className="tag t-red">{p.overdueCount} overdue</span> : <span className="tag t-green">on track</span>}
              </div>
              <div className="muted" style={{ marginBottom: 10 }}>{p.deal?.title || 'No linked deal'}</div>

              <div className="spread" style={{ marginBottom: 5 }}>
                <span style={{ fontSize: 13, fontWeight: 700 }}>{fmtGHS(p.paidAmount)} <span className="muted">of {fmtGHS(p.total)}</span></span>
                <span style={{ fontSize: 12, fontWeight: 700, color: overdue ? 'var(--red)' : 'var(--green-bright)' }}>{pct}%</span>
              </div>
              <div className={`progress${overdue ? ' red' : ''}`} style={{ marginBottom: 8 }}><div style={{ width: `${pct}%` }} /></div>

              <div className="spread muted" style={{ marginBottom: 10 }}>
                <span>Installment {Math.min(p.currentInstallment, p.installment_count)} of {p.installment_count}</span>
                {p.nextDue && <span style={{ color: overdue ? 'var(--red)' : undefined }}>next: {fmtGHS(p.nextDue.amount)} · {p.nextDue.due_date}</span>}
              </div>

              {/* Construction tracker feeds the client portal identically */}
              {p.unit && (
                <div style={{ background: 'var(--bg-elevated)', borderRadius: 8, padding: '8px 10px', marginBottom: 10 }}>
                  <div className="spread" style={{ marginBottom: 4 }}>
                    <span style={{ fontSize: 11.5, fontWeight: 600 }}>🏗 {p.unit.name} — {p.unit.completion_pct}% built</span>
                    {p.unit.handover_date && <span className="muted">handover {p.unit.handover_date}</span>}
                  </div>
                  <div className="progress" style={{ height: 5 }}><div style={{ width: `${p.unit.completion_pct}%` }} /></div>
                </div>
              )}

              <div className="row" style={{ gap: 6 }}>
                <button className="btn btn-sm btn-green" onClick={() => { setRecordFor(p); setPay({ amount: String(p.nextDue?.amount || ''), method: 'momo', receipt_url: '' }); }}>Record payment</button>
                {p.unit && <button className="btn btn-sm" onClick={() => { setTrackFor(p); setTrack({ completion_pct: String(p.unit.completion_pct), handover_date: p.unit.handover_date || '' }); }}>Update build</button>}
              </div>
            </div>
          );
        })}
        {plans.length === 0 && <div className="card muted" style={{ textAlign: 'center', padding: 26 }}>No payment plans yet.</div>}
      </div>

      {/* Record a bank / MoMo / cash payment (way 2 — client in-app is way 1) */}
      {recordFor && (
        <Modal title={`Record payment — ${recordFor.client?.name}`} onClose={() => setRecordFor(null)}>
          <form onSubmit={async (e) => {
            e.preventDefault(); setBusy(true);
            try {
              await api.plans.recordPayment(recordFor.id, { ...pay, amount: Number(pay.amount) });
              setRecordFor(null); load();
            } finally { setBusy(false); }
          }}>
            <div className="row" style={{ gap: 10 }}>
              <div className="form-group" style={{ flex: 1 }}><label className="form-label">Amount (GHS) *</label>
                <input className="form-input" type="number" required value={pay.amount} onChange={(e) => setPay((p) => ({ ...p, amount: e.target.value }))} /></div>
              <div className="form-group" style={{ flex: 1 }}><label className="form-label">Method *</label>
                <select className="form-select" value={pay.method} onChange={(e) => setPay((p) => ({ ...p, method: e.target.value }))}>
                  {['momo', 'bank', 'cash', 'card'].map((m) => <option key={m}>{m}</option>)}
                </select></div>
            </div>
            <div className="form-group">
              <label className="form-label">Receipt / proof</label>
              <input className="form-input" type="file" accept="image/*" onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                const url = await fileToDataUrl(f);
                setPay((p) => ({ ...p, receipt_url: url }));
              }} />
            </div>
            <div className="muted" style={{ marginBottom: 12 }}>Goes to the Owner/Admin approval queue, then the balance moves everywhere at once.</div>
            <button className="btn btn-green btn-block" disabled={busy}>{busy ? 'Recording…' : 'Record payment'}</button>
          </form>
        </Modal>
      )}

      {showCreate && (
        <Modal title="New payment plan" onClose={() => setShowCreate(false)}>
          <form onSubmit={async (e) => {
            e.preventDefault(); setBusy(true);
            try {
              await api.plans.create({
                client_id: create.client_id, deal_id: create.deal_id || undefined, unit_id: create.unit_id || undefined,
                total: Number(create.total), installment_count: Number(create.installment_count),
                start_date: create.start_date || undefined,
              });
              setShowCreate(false); load();
            } catch (er: any) { alert(er.message); } finally { setBusy(false); }
          }}>
            <div className="form-group"><label className="form-label">Client *</label>
              <select className="form-select" required value={create.client_id} onChange={(e) => setCreate((p) => ({ ...p, client_id: e.target.value }))}>
                <option value="">— select —</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select></div>
            <div className="form-group"><label className="form-label">Linked deal</label>
              <select className="form-select" value={create.deal_id} onChange={(e) => setCreate((p) => ({ ...p, deal_id: e.target.value }))}>
                <option value="">— none —</option>
                {deals.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
              </select></div>
            <div className="form-group"><label className="form-label">Unit (for construction tracking)</label>
              <select className="form-select" value={create.unit_id} onChange={(e) => setCreate((p) => ({ ...p, unit_id: e.target.value }))}>
                <option value="">— none —</option>
                {units.map((u) => <option key={u.id} value={u.id}>{u.property?.title} · {u.name}</option>)}
              </select></div>
            <div className="row" style={{ gap: 10 }}>
              <div className="form-group" style={{ flex: 1 }}><label className="form-label">Total (GHS) *</label>
                <input className="form-input" type="number" required value={create.total} onChange={(e) => setCreate((p) => ({ ...p, total: e.target.value }))} /></div>
              <div className="form-group" style={{ width: 120 }}><label className="form-label">Installments *</label>
                <input className="form-input" type="number" required value={create.installment_count} onChange={(e) => setCreate((p) => ({ ...p, installment_count: e.target.value }))} /></div>
            </div>
            <div className="form-group"><label className="form-label">Start date</label>
              <input className="form-input" type="date" value={create.start_date} onChange={(e) => setCreate((p) => ({ ...p, start_date: e.target.value }))} /></div>
            {Number(create.total) > 0 && Number(create.installment_count) > 0 && (
              <div className="muted" style={{ marginBottom: 12 }}>≈ {fmtGHS(Number(create.total) / Number(create.installment_count))} per month</div>
            )}
            <button className="btn btn-green btn-block" disabled={busy}>{busy ? 'Creating…' : 'Create plan + schedule'}</button>
          </form>
        </Modal>
      )}

      {trackFor && (
        <Modal title={`Construction — ${trackFor.unit?.name}`} onClose={() => setTrackFor(null)}>
          <div className="form-group">
            <label className="form-label">Completion: {track.completion_pct}%</label>
            <input type="range" min={0} max={100} style={{ width: '100%' }} value={track.completion_pct} onChange={(e) => setTrack((p) => ({ ...p, completion_pct: e.target.value }))} />
          </div>
          <div className="form-group"><label className="form-label">Handover date</label>
            <input className="form-input" type="date" value={track.handover_date} onChange={(e) => setTrack((p) => ({ ...p, handover_date: e.target.value }))} /></div>
          <div className="muted" style={{ marginBottom: 12 }}>The client sees this instantly in their portal.</div>
          <button className="btn btn-green btn-block" onClick={async () => {
            await api.plans.updateUnit(trackFor.unit.id, { completion_pct: Number(track.completion_pct), handover_date: track.handover_date || null });
            setTrackFor(null); load();
          }}>Save progress</button>
        </Modal>
      )}
    </div>
  );
}
