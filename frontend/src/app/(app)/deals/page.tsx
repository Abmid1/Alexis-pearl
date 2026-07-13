'use client';
import { useEffect, useState } from 'react';
import { api, authStore } from '@/lib/api';
import { ScreenHead, Modal, fmtGHS } from '@/components/Shell';
import { I } from '@/components/Icons';

const STATUS_TAG: Record<string, [string, string]> = {
  draft: ['t-gray', 'Draft'],
  pending_approval: ['t-amber', 'Pending approval'],
  approved: ['t-green', 'Approved'],
  changes_requested: ['t-red', 'Changes requested'],
  closed: ['t-blue', 'Closed'],
};

export default function Deals() {
  const user = typeof window !== 'undefined' ? authStore.getUser() : null;
  const isManager = ['owner', 'admin'].includes(user?.role);
  const [deals, setDeals] = useState<any[]>([]);
  const [team, setTeam] = useState<any[]>([]);
  const [leads, setLeads] = useState<any[]>([]);
  const [props, setProps] = useState<any[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [changeFor, setChangeFor] = useState<any>(null);
  const [changeNote, setChangeNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ title: '', sale_price: '', commission_rate: '5', lead_id: '', property_id: '', split_with: '', split_pct: '100' });

  const load = () => api.deals.list().then(setDeals).catch(() => {});
  useEffect(() => {
    load();
    api.misc.team().then(setTeam).catch(() => {});
    api.leads.list().then(setLeads).catch(() => {});
    api.marketing.listings().then(setProps).catch(() => {});
  }, []);

  const price = Number(form.sale_price) || 0;
  const rate = Number(form.commission_rate) || 0;
  const commission = price * rate / 100;
  const myPct = Number(form.split_pct) || 100;

  const add = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    try {
      const splits = form.split_with && myPct < 100
        ? [{ user_id: user.id, pct: myPct }, { user_id: form.split_with, pct: 100 - myPct }]
        : undefined;
      await api.deals.create({
        title: form.title, sale_price: price, commission_rate: rate,
        lead_id: form.lead_id || undefined, property_id: form.property_id || undefined, splits,
      });
      setShowAdd(false);
      setForm({ title: '', sale_price: '', commission_rate: '5', lead_id: '', property_id: '', split_with: '', split_pct: '100' });
      load();
    } catch (e: any) { alert(e.message); } finally { setBusy(false); }
  };

  return (
    <div>
      <ScreenHead id="1c" title="Deals & Commission" phase={1}>
        <button className="btn btn-green" onClick={() => setShowAdd(true)}>+ New deal</button>
      </ScreenHead>

      <div className="muted" style={{ marginBottom: 14 }}>
        Commission auto-calculates (price × rate). A deal only closes on Owner/Admin approval.
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {deals.map((d) => {
          const [cls, label] = STATUS_TAG[d.status] || ['t-gray', d.status];
          return (
            <div key={d.id} className="card">
              <div className="spread" style={{ marginBottom: 8, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{d.title}</div>
                <span className={`tag ${cls}`}>{label}</span>
              </div>
              <div className="row" style={{ flexWrap: 'wrap', gap: 14, marginBottom: 10 }}>
                <div><div className="muted">Sale price</div><div style={{ fontWeight: 700 }}>{fmtGHS(d.sale_price)}</div></div>
                <div><div className="muted">Rate</div><div style={{ fontWeight: 700 }}>{d.commission_rate}%</div></div>
                <div><div className="muted">Commission</div><div style={{ fontWeight: 700, color: 'var(--green-bright)' }}>{fmtGHS(d.commission_amount)}</div></div>
                <div><div className="muted">Agent</div><div style={{ fontWeight: 600 }}>{d.agent?.name}</div></div>
              </div>

              {/* Split — exact GHS per person */}
              {d.splits?.length > 0 && (
                <div className="row" style={{ flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                  {d.splits.map((s: any) => (
                    <span key={s.id} className="tag t-blue">{s.user?.name}: {s.pct}% = {fmtGHS(s.amount)}</span>
                  ))}
                </div>
              )}

              {d.status === 'changes_requested' && d.change_note && (
                <div style={{ fontSize: 12, color: 'var(--red)', background: 'rgba(248,113,113,0.07)', borderRadius: 8, padding: '8px 10px', marginBottom: 10 }}>
                  <I name="alert" size={12} style={{ marginRight: 4, verticalAlign: '-2px' }} />{d.change_note}
                </div>
              )}

              <div className="row" style={{ gap: 8 }}>
                {isManager && d.status === 'pending_approval' && (
                  <>
                    <button className="btn btn-sm btn-green" onClick={async () => { await api.deals.approve(d.id); load(); }}><I name="check" size={13} /> Approve</button>
                    <button className="btn btn-sm" onClick={() => { setChangeFor(d); setChangeNote(''); }}>Request changes</button>
                  </>
                )}
                {d.status === 'changes_requested' && d.agent?.id === user?.id && (
                  <button className="btn btn-sm btn-green" onClick={async () => { await api.deals.update(d.id, {}); load(); }}>Resubmit for approval</button>
                )}
              </div>
            </div>
          );
        })}
        {deals.length === 0 && <div className="card muted" style={{ textAlign: 'center', padding: 30 }}>No deals yet — create one from a closing-stage lead.</div>}
      </div>

      {showAdd && (
        <Modal title="New deal" onClose={() => setShowAdd(false)}>
          <form onSubmit={add}>
            <div className="form-group">
              <label className="form-label">Deal title *</label>
              <input className="form-input" required value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} placeholder="e.g. Unit 12 · East Legon — Esi Nyarko" />
            </div>
            <div className="form-group">
              <label className="form-label">Link a lead</label>
              <select className="form-select" value={form.lead_id} onChange={(e) => setForm((p) => ({ ...p, lead_id: e.target.value }))}>
                <option value="">— none —</option>
                {leads.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.stage})</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Property</label>
              <select className="form-select" value={form.property_id} onChange={(e) => setForm((p) => ({ ...p, property_id: e.target.value }))}>
                <option value="">— none —</option>
                {props.map((pr) => <option key={pr.id} value={pr.id}>{pr.title}</option>)}
              </select>
            </div>
            <div className="row" style={{ gap: 10 }}>
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">Sale price (GHS) *</label>
                <input className="form-input" type="number" required value={form.sale_price} onChange={(e) => setForm((p) => ({ ...p, sale_price: e.target.value }))} />
              </div>
              <div className="form-group" style={{ width: 110 }}>
                <label className="form-label">Rate %</label>
                <input className="form-input" type="number" step="0.5" value={form.commission_rate} onChange={(e) => setForm((p) => ({ ...p, commission_rate: e.target.value }))} />
              </div>
            </div>

            {/* live commission preview */}
            <div className="card" style={{ marginBottom: 13, padding: 12, background: 'var(--bg-elevated)' }}>
              <div className="spread">
                <span className="muted">Commission (auto)</span>
                <strong style={{ color: 'var(--green-bright)' }}>{fmtGHS(commission)}</strong>
              </div>
            </div>

            <div className="row" style={{ gap: 10 }}>
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">Split with</label>
                <select className="form-select" value={form.split_with} onChange={(e) => setForm((p) => ({ ...p, split_with: e.target.value }))}>
                  <option value="">No split — 100% me</option>
                  {team.filter((t) => t.id !== user?.id).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              {form.split_with && (
                <div className="form-group" style={{ width: 110 }}>
                  <label className="form-label">My %</label>
                  <input className="form-input" type="number" min={1} max={99} value={form.split_pct} onChange={(e) => setForm((p) => ({ ...p, split_pct: e.target.value }))} />
                </div>
              )}
            </div>
            {form.split_with && myPct < 100 && (
              <div className="muted" style={{ marginBottom: 12 }}>
                You: {fmtGHS(commission * myPct / 100)} · Partner: {fmtGHS(commission * (100 - myPct) / 100)}
              </div>
            )}

            <button className="btn btn-green btn-block" disabled={busy}>{busy ? 'Submitting…' : 'Submit for approval'}</button>
          </form>
        </Modal>
      )}

      {changeFor && (
        <Modal title="Request changes" onClose={() => setChangeFor(null)}>
          <div className="form-group">
            <label className="form-label">What needs to change on “{changeFor.title}”?</label>
            <textarea className="form-input" rows={3} value={changeNote} onChange={(e) => setChangeNote(e.target.value)} placeholder="e.g. Rate should be 4% per the developer agreement" />
          </div>
          <button className="btn btn-green btn-block" onClick={async () => {
            await api.deals.requestChanges(changeFor.id, changeNote || 'Changes requested');
            setChangeFor(null); load();
          }}>Send back to agent</button>
        </Modal>
      )}
    </div>
  );
}
