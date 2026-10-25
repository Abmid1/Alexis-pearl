'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, authStore } from '@/lib/api';
import { ScreenHead, Modal, timeAgo } from '@/components/Shell';
import { I } from '@/components/Icons';

const ASTATUS: Record<string, [string, string]> = {
  submitted: ['t-amber', 'Submitted'], under_review: ['t-blue', 'Under review'], info_requested: ['t-purple', 'Info requested'],
  approved: ['t-green', 'Approved'], declined: ['t-red', 'Declined'], withdrawn: ['t-gray', 'Withdrawn'],
};
const TABS = [
  { key: 'submitted,under_review,info_requested', label: 'Open' },
  { key: 'approved,declined,withdrawn', label: 'Closed' },
  { key: 'all', label: 'All' },
];
const NEXT: Record<string, string[]> = {
  submitted: ['under_review', 'info_requested', 'approved', 'declined'],
  under_review: ['info_requested', 'approved', 'declined'],
  info_requested: ['under_review', 'approved', 'declined'],
  approved: ['declined'], declined: ['under_review'], withdrawn: [],
};
const kb = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export default function Applications() {
  const router = useRouter();
  const user = typeof window !== 'undefined' ? authStore.getUser() : null;
  const isManager = ['owner', 'admin'].includes(user?.role);
  const [tab, setTab] = useState(TABS[0].key);
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState<any>(null);

  const load = async () => {
    setLoading(true); setErr('');
    try { setRows(await api.applications.list(tab)); } catch (e: any) { setErr(e.message); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [tab]);
  const show = async (id: string) => { try { setOpen(await api.applications.get(id)); } catch (e: any) { setErr(e.message); } };

  return (
    <div>
      <ScreenHead id="" title="Applications">
        <button className="btn" onClick={load}><I name="refresh" size={13} /> Refresh</button>
      </ScreenHead>
      <div className="row" style={{ gap: 6, marginBottom: 14 }}>
        {TABS.map((t) => <button key={t.key} className={`btn btn-sm${tab === t.key ? ' btn-green' : ''}`} onClick={() => setTab(t.key)}>{t.label}</button>)}
      </div>
      {err && <div className="card" style={{ borderColor: 'var(--red)', color: 'var(--red)', marginBottom: 12 }}>{err}</div>}
      {loading && <div className="muted">Loading…</div>}
      {!loading && !rows.length && (
        <div className="card" style={{ textAlign: 'center', padding: 30 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>No applications here</div>
          <div className="muted">Customers apply from a listing on your website after signing in. Edit the questions under Website.</div>
        </div>
      )}
      {!!rows.length && (
        <div className="card table-wrap" style={{ padding: 0 }}>
          <table className="table">
            <thead><tr><th>Ref</th><th>Applicant</th><th>Property</th><th>Type</th><th>Agent</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {rows.map((a) => {
                const [cls, label] = ASTATUS[a.status] || ['t-gray', a.status];
                return (
                  <tr key={a.id} style={{ cursor: 'pointer' }} onClick={() => show(a.id)}>
                    <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{a.reference}<div className="muted">{timeAgo(a.created_at)}</div></td>
                    <td><div style={{ fontWeight: 600 }}>{a.client?.name}</div><div className="muted">{a.client?.verified_phone || a.client?.verified_email}</div></td>
                    <td>{a.property?.title}</td>
                    <td style={{ textTransform: 'capitalize' }}>{a.kind}</td>
                    <td>{a.lead?.owner?.name || '—'}</td>
                    <td><span className={`tag ${cls}`}>{label}</span></td>
                    <td><button className="btn btn-sm">Open</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {open && <Detail a={open} isManager={isManager} onClose={() => setOpen(null)} onChanged={async () => { await show(open.id); load(); }} goInbox={() => router.push('/inbox')} />}
    </div>
  );
}

function Detail({ a, isManager, onClose, onChanged, goInbox }: any) {
  const [status, setStatus] = useState('');
  const [message, setMessage] = useState('');
  const [docs, setDocs] = useState('');
  const [notify, setNotify] = useState(true);
  const [note, setNote] = useState(a.staff_note || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [cls, label] = ASTATUS[a.status] || ['t-gray', a.status];
  const options = (NEXT[a.status] || []).filter((s) => isManager || !['approved', 'declined'].includes(s));
  const answers = Object.entries(a.answers || {});

  const run = async (fn: () => Promise<any>) => { setBusy(true); setErr(''); try { await fn(); await onChanged(); setStatus(''); setMessage(''); setDocs(''); } catch (e: any) { setErr(e.message); } finally { setBusy(false); } };
  const openDoc = async (docId: string) => {
    const w = window.open('', '_blank'); if (w) w.opener = null;
    try { const r = await api.applications.documentUrl(a.id, docId); if (w) w.location.href = r.url; } catch (e: any) { w?.close(); setErr(e.message); }
  };

  return (
    <Modal title={`${a.reference} — ${a.property?.title || ''}`} onClose={onClose}>
      {err && <div style={{ color: 'var(--red)', fontSize: 12, marginBottom: 10 }}>{err}</div>}
      <div className="spread" style={{ marginBottom: 10 }}>
        <div><div style={{ fontWeight: 700 }}>{a.client?.name}</div><div className="muted">{[a.client?.verified_phone, a.client?.verified_email].filter(Boolean).join(' · ')} (verified)</div></div>
        <span className={`tag ${cls}`}>{label}</span>
      </div>
      {a.lead && <div className="muted" style={{ marginBottom: 10 }}>Lead: {a.lead.name} · stage {a.lead.stage} · agent {a.lead.owner?.name || '—'} · <a onClick={goInbox} style={{ cursor: 'pointer' }}>open conversation</a></div>}

      <div className="section-title" style={{ marginTop: 6 }}>Answers</div>
      {answers.length ? answers.map(([k, v]) => <div key={k} style={{ fontSize: 13, marginBottom: 4 }}><span className="muted">{k.replace(/_/g, ' ')}:</span> {String(v)}</div>) : <div className="muted">No answers given.</div>}

      <div className="section-title">Documents</div>
      {a.documents?.length ? a.documents.map((d: any) => (
        <div key={d.id} className="spread" style={{ fontSize: 13, marginBottom: 6 }}>
          <span><I name="doc" size={13} /> {d.label || d.file_name} <span className="muted">· {d.file_name} · {kb(d.size_bytes)} · {timeAgo(d.created_at)}</span></span>
          <button className="btn btn-sm" onClick={() => openDoc(d.id)}>View</button>
        </div>
      )) : <div className="muted">None uploaded yet.</div>}
      <div className="muted" style={{ marginTop: 4 }}>Links expire after 60 seconds and every view is recorded in the audit log.</div>
      {a.customer_message && <div className="muted" style={{ marginTop: 8 }}>Last message to customer: “{a.customer_message}”</div>}

      {options.length > 0 && (
        <>
          <div className="section-title">Update status</div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
            {options.map((s) => <button key={s} className={`btn btn-sm${status === s ? ' btn-green' : ''}`} onClick={() => setStatus(s)}>{ASTATUS[s][1]}</button>)}
          </div>
          {status && (
            <>
              <div className="form-group"><label className="form-label">Message to the customer {status === 'info_requested' ? '*' : '(optional)'}</label>
                <textarea className="form-input" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} placeholder={status === 'info_requested' ? 'What do you need from them?' : ''} /></div>
              {status === 'info_requested' && (
                <div className="form-group"><label className="form-label">Documents to upload (comma-separated)</label>
                  <input className="form-input" value={docs} onChange={(e) => setDocs(e.target.value)} placeholder="Ghana Card, Last 3 payslips" /></div>
              )}
              <label className="row" style={{ gap: 6, fontSize: 12, marginBottom: 10 }}><input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Notify the customer (respects their preferences)</label>
              <button className="btn btn-green btn-block" disabled={busy} onClick={() => run(() => api.applications.setStatus(a.id, {
                status, message: message || undefined, notify,
                requested_documents: docs.split(',').map((x) => x.trim()).filter(Boolean),
              }))}>{busy ? 'Saving…' : `Set to “${ASTATUS[status][1]}”`}</button>
            </>
          )}
        </>
      )}

      <div className="section-title">Internal note</div>
      <textarea className="form-input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Never shown to the customer" />
      <button className="btn btn-sm" style={{ marginTop: 6 }} disabled={busy} onClick={() => run(() => api.applications.note(a.id, note))}>Save note</button>
    </Modal>
  );
}
