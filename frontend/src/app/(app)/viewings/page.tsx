'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, authStore } from '@/lib/api';
import { ScreenHead, Modal, timeAgo } from '@/components/Shell';
import { I } from '@/components/Icons';

const VSTATUS: Record<string, [string, string]> = {
  requested: ['t-amber', 'Requested'], confirmed: ['t-green', 'Confirmed'], declined: ['t-red', 'Declined'],
  cancelled: ['t-gray', 'Cancelled'], completed: ['t-blue', 'Attended'], no_show: ['t-purple', 'No-show'],
};
const ESTATUS: Record<string, [string, string]> = { new: ['t-amber', 'New'], in_progress: ['t-blue', 'In progress'], closed: ['t-gray', 'Closed'] };

const TABS = [
  { key: 'requested', label: 'Requests' },
  { key: 'confirmed', label: 'Upcoming' },
  { key: 'completed,no_show,declined,cancelled', label: 'Past' },
  { key: 'enquiries', label: 'Website enquiries' },
];

/** Africa/Accra is UTC+0 with no daylight saving. */
const fmt = (iso: string) => new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Accra' });
const toLocalInput = (iso: string) => new Date(iso).toISOString().slice(0, 16);
const fromLocalInput = (v: string) => new Date(`${v}:00Z`).toISOString();

export default function Viewings() {
  const router = useRouter();
  const user = typeof window !== 'undefined' ? authStore.getUser() : null;
  const isManager = ['owner', 'admin'].includes(user?.role);
  const [tab, setTab] = useState('requested');
  const [rows, setRows] = useState<any[]>([]);
  const [team, setTeam] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [modal, setModal] = useState<{ kind: string; v: any } | null>(null);

  const load = async () => {
    setLoading(true); setErr('');
    try {
      setRows(tab === 'enquiries' ? await api.enquiries.list() : await api.viewings.list(tab));
    } catch (e: any) { setErr(e.message); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [tab]);
  useEffect(() => { api.misc.team().then((t: any[]) => setTeam(t.filter((m) => ['agent', 'owner', 'admin'].includes(m.role)))).catch(() => {}); }, []);

  const act = async (fn: () => Promise<any>) => {
    setErr('');
    try { await fn(); setModal(null); load(); } catch (e: any) { setErr(e.message); }
  };

  return (
    <div>
      <ScreenHead id="" title="Viewings & website enquiries">
        <button className="btn" onClick={load}><I name="refresh" size={13} /> Refresh</button>
      </ScreenHead>

      <div className="row" style={{ gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <button key={t.key} className={`btn btn-sm${tab === t.key ? ' btn-green' : ''}`} onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
      </div>

      {err && <div className="card" style={{ borderColor: 'var(--red)', color: 'var(--red)', marginBottom: 12 }}>{err}</div>}
      {loading && <div className="muted">Loading…</div>}

      {!loading && !rows.length && (
        <div className="card" style={{ textAlign: 'center', padding: 30 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{tab === 'enquiries' ? 'No website enquiries yet' : 'Nothing here'}</div>
          <div className="muted">Requests made on your public website appear here automatically.</div>
        </div>
      )}

      {tab === 'enquiries' ? (
        <div className="card table-wrap" style={{ padding: 0 }}>
          {!!rows.length && (
            <table className="table">
              <thead><tr><th>Ref</th><th>From</th><th>About</th><th>Message</th><th>Owner</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {rows.map((e) => {
                  const [cls] = ESTATUS[e.status] || ['t-gray'];
                  return (
                    <tr key={e.id}>
                      <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{e.reference}<div className="muted">{timeAgo(e.created_at)}</div></td>
                      <td>
                        <div style={{ fontWeight: 600 }}>{e.name}</div>
                        {e.phone && <a href={`tel:${e.phone}`} className="muted" style={{ display: 'block' }}>{e.phone}</a>}
                        {e.email && <a href={`mailto:${e.email}`} className="muted" style={{ display: 'block' }}>{e.email}</a>}
                        {e.contact_consent && <span className="tag t-green" style={{ marginTop: 3 }}>OK to message</span>}
                      </td>
                      <td>{e.property?.title || <span className="muted">General</span>}<div className="muted">{e.kind === 'viewing' ? 'Viewing request' : e.source === 'assistant' ? 'Via assistant' : 'Enquiry'}</div></td>
                      <td style={{ maxWidth: 260, fontSize: 12, color: 'var(--text-secondary)' }}>{e.message || '—'}</td>
                      <td>{e.lead?.owner?.name || '—'}</td>
                      <td>
                        <select className={`form-select tag ${cls}`} style={{ minHeight: 28, padding: '2px 6px', width: 'auto' }} value={e.status}
                          onChange={(ev) => act(() => api.enquiries.setStatus(e.id, ev.target.value))}>
                          {Object.entries(ESTATUS).map(([k, [, l]]) => <option key={k} value={k}>{l}</option>)}
                        </select>
                      </td>
                      <td><button className="btn btn-sm" onClick={() => router.push('/inbox')}><I name="chat" size={12} /> Reply</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
          {rows.map((v) => {
            const [cls, label] = VSTATUS[v.status] || ['t-gray', v.status];
            const past = new Date(v.ends_at) < new Date();
            return (
              <div key={v.id} className="card">
                <div className="spread" style={{ marginBottom: 6 }}>
                  <div style={{ fontWeight: 700, fontSize: 13.5 }}>{v.property?.title || 'Property'}</div>
                  <span className={`tag ${cls}`}>{label}</span>
                </div>
                <div className="row" style={{ gap: 5, fontWeight: 600, marginBottom: 6 }}><I name="clock" size={13} /> {fmt(v.starts_at)}{past && v.status === 'confirmed' && <span className="tag t-amber">Record outcome</span>}</div>
                <div style={{ fontSize: 13, marginBottom: 4 }}>{v.contact_name} {v.lead && <span className="muted">· lead: {v.lead.stage}</span>}</div>
                <div className="row" style={{ gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
                  {v.contact_phone && <a href={`tel:${v.contact_phone}`} className="muted"><I name="phone" size={11} /> {v.contact_phone}</a>}
                  {v.contact_email && <a href={`mailto:${v.contact_email}`} className="muted"><I name="mail" size={11} /> {v.contact_email}</a>}
                </div>
                {v.customer_note && <div style={{ fontSize: 12, background: 'var(--bg)', borderRadius: 4, padding: '6px 8px', marginBottom: 6 }}>“{v.customer_note}”</div>}
                {v.staff_note && <div className="muted" style={{ marginBottom: 6 }}><I name="edit" size={11} /> Internal: {v.staff_note}</div>}
                {v.outcome && <div className="muted" style={{ marginBottom: 6 }}>Outcome: {v.outcome}</div>}
                <div className="muted" style={{ marginBottom: 10 }}>
                  Agent: {v.agent?.name || 'unassigned'} · ref {v.reference}{v.enquiry?.contact_consent ? ' · OK to message' : ' · no message consent'}
                </div>
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  {['requested', 'declined'].includes(v.status) && <button className="btn btn-sm btn-green" onClick={() => setModal({ kind: 'confirm', v })}><I name="check" size={12} /> Confirm</button>}
                  {v.status === 'requested' && <button className="btn btn-sm btn-red" onClick={() => setModal({ kind: 'decline', v })}>Decline</button>}
                  {['requested', 'confirmed'].includes(v.status) && <button className="btn btn-sm" onClick={() => setModal({ kind: 'reschedule', v })}>Reschedule</button>}
                  {v.status === 'confirmed' && (
                    <>
                      <button className="btn btn-sm" onClick={() => setModal({ kind: 'outcome', v })}>Attended / no-show</button>
                      <button className="btn btn-sm btn-red" onClick={() => setModal({ kind: 'cancel', v })}>Cancel</button>
                    </>
                  )}
                  <button className="btn btn-sm" onClick={() => setModal({ kind: 'note', v })}><I name="edit" size={12} /> Note</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {modal && <ActionModal modal={modal} team={team} isManager={isManager} onClose={() => setModal(null)} act={act} err={err} />}
    </div>
  );
}

function ActionModal({ modal, team, isManager, onClose, act, err }: any) {
  const { kind, v } = modal;
  const [agent, setAgent] = useState(v.agent_id || '');
  const [when, setWhen] = useState(toLocalInput(v.starts_at));
  const [dur, setDur] = useState(Math.round((new Date(v.ends_at).getTime() - new Date(v.starts_at).getTime()) / 60000));
  const [text, setText] = useState(kind === 'note' ? v.staff_note || '' : '');
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const consent = !!v.enquiry?.contact_consent;
  const run = async (fn: () => Promise<any>) => { setBusy(true); await act(fn); setBusy(false); };

  const notifyBox = (
    <label className="row" style={{ gap: 6, fontSize: 12, marginBottom: 12, opacity: consent ? 1 : 0.6 }}>
      <input type="checkbox" checked={notify && consent} disabled={!consent} onChange={(e) => setNotify(e.target.checked)} />
      {consent ? 'Notify the customer (WhatsApp/email via your outbox)' : 'Customer did not consent to messages — call them instead'}
    </label>
  );
  const title = { confirm: 'Confirm viewing', decline: 'Decline request', reschedule: 'Reschedule', cancel: 'Cancel viewing', outcome: 'Record attendance', note: 'Internal note' }[kind as string] || '';

  return (
    <Modal title={`${title} — ${v.property?.title || ''}`} onClose={onClose}>
      {err && <div style={{ color: 'var(--red)', fontSize: 12, marginBottom: 10 }}>{err}</div>}
      {(kind === 'confirm' || kind === 'reschedule') && (
        <>
          <div className="row" style={{ gap: 10 }}>
            <div className="form-group" style={{ flex: 1 }}><label className="form-label">Date & time (Accra, GMT)</label>
              <input className="form-input" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></div>
            <div className="form-group" style={{ width: 110 }}><label className="form-label">Minutes</label>
              <input className="form-input" type="number" min={15} max={480} value={dur} onChange={(e) => setDur(Number(e.target.value))} /></div>
          </div>
          {kind === 'confirm' && (
            <div className="form-group"><label className="form-label">Agent</label>
              <select className="form-select" value={agent} onChange={(e) => setAgent(e.target.value)} disabled={!isManager && !!v.agent_id}>
                <option value="">Me</option>
                {team.map((m: any) => <option key={m.id} value={m.id}>{m.name} ({m.role})</option>)}
              </select></div>
          )}
          {notifyBox}
          <button className="btn btn-green btn-block" disabled={busy} onClick={() => run(() => kind === 'confirm'
            ? api.viewings.confirm(v.id, { starts_at: fromLocalInput(when), duration_minutes: dur, agent_id: agent || undefined, notify: notify && consent })
            : api.viewings.reschedule(v.id, { starts_at: fromLocalInput(when), duration_minutes: dur, notify: notify && consent }))}>
            {busy ? 'Saving…' : kind === 'confirm' ? 'Confirm viewing' : 'Save new time'}
          </button>
          <div className="muted" style={{ marginTop: 8 }}>Overlapping confirmed viewings for this property or agent are blocked automatically.</div>
        </>
      )}
      {(kind === 'decline' || kind === 'cancel') && (
        <>
          <div className="form-group"><label className="form-label">{kind === 'decline' ? 'Reason shown to the customer' : 'Reason (optional, shown to the customer)'}</label>
            <textarea className="form-input" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={kind === 'decline' ? 'e.g. That time is taken — Saturday morning works.' : ''} /></div>
          {notifyBox}
          <button className="btn btn-red btn-block" disabled={busy} onClick={() => run(() => kind === 'decline' ? api.viewings.decline(v.id, text, notify && consent) : api.viewings.cancel(v.id, text))}>
            {kind === 'decline' ? 'Decline request' : 'Cancel viewing'}
          </button>
        </>
      )}
      {kind === 'outcome' && (
        <>
          <div className="form-group"><label className="form-label">Outcome (internal)</label>
            <textarea className="form-input" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Interest level, objections, next step…" /></div>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn-green" style={{ flex: 1 }} disabled={busy} onClick={() => run(() => api.viewings.outcome(v.id, 'completed', text))}>Attended</button>
            <button className="btn" style={{ flex: 1 }} disabled={busy} onClick={() => run(() => api.viewings.outcome(v.id, 'no_show', text))}>No-show</button>
          </div>
        </>
      )}
      {kind === 'note' && (
        <>
          <div className="form-group"><label className="form-label">Internal note — never shown to the customer</label>
            <textarea className="form-input" rows={4} value={text} onChange={(e) => setText(e.target.value)} /></div>
          {isManager && (
            <div className="form-group"><label className="form-label">Assigned agent</label>
              <select className="form-select" value={agent} onChange={(e) => setAgent(e.target.value)}>
                <option value="">Unassigned</option>
                {team.map((m: any) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select></div>
          )}
          <button className="btn btn-green btn-block" disabled={busy} onClick={() => run(() => api.viewings.update(v.id, isManager ? { staff_note: text, agent_id: agent || null } : { staff_note: text }))}>Save</button>
        </>
      )}
    </Modal>
  );
}
