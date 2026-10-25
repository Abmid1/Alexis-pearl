'use client';
import { useEffect, useState } from 'react';
import { api, authStore } from '@/lib/api';
import { ScreenHead, Modal, fmtGHS, timeAgo } from '@/components/Shell';
import { I } from '@/components/Icons';

/** Documents customers asked for, landlord submissions, offers and transaction progress. */
const TABS = [
  { key: 'documents', label: 'Document requests' },
  { key: 'services', label: 'Landlord & services' },
  { key: 'offers', label: 'Offers' },
  { key: 'transactions', label: 'Progress' },
];
const DOC_TAG: Record<string, [string, string]> = {
  requested: ['t-amber', 'Requested'], in_progress: ['t-blue', 'Being prepared'], ready: ['t-green', 'Ready'],
  declined: ['t-red', 'Not issued'], cancelled: ['t-gray', 'Cancelled'],
};
const SVC_TAG: Record<string, [string, string]> = { new: ['t-amber', 'New'], in_progress: ['t-blue', 'In progress'], closed: ['t-gray', 'Closed'] };
const OFFER_TAG: Record<string, [string, string]> = {
  draft: ['t-gray', 'Draft'], sent: ['t-amber', 'Awaiting reply'], accepted: ['t-green', 'Accepted'],
  declined: ['t-red', 'Declined'], withdrawn: ['t-gray', 'Withdrawn'], expired: ['t-purple', 'Expired'],
};
const kb = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const toBase64 = (f: File) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result || '')); r.onerror = () => rej(new Error('Could not read file')); r.readAsDataURL(f); });

export default function Requests() {
  const user = typeof window !== 'undefined' ? authStore.getUser() : null;
  const isManager = ['owner', 'admin'].includes(user?.role);
  const [tab, setTab] = useState('documents');
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState<any>(null);
  const [newOffer, setNewOffer] = useState(false);
  const [newTx, setNewTx] = useState(false);

  const load = async () => {
    setLoading(true); setErr('');
    try {
      const fn = { documents: api.docRequests.list, services: api.serviceRequests.list, offers: api.offers.list, transactions: api.transactions.list } as any;
      setRows(await fn[tab]());
    } catch (e: any) { setErr(e.message); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [tab]);
  const run = async (fn: () => Promise<any>) => { setErr(''); try { await fn(); setOpen(null); setNewOffer(false); setNewTx(false); await load(); } catch (e: any) { setErr(e.message); } };

  return (
    <div>
      <ScreenHead id="" title="Customer requests">
        {tab === 'offers' && isManager && <button className="btn btn-green" onClick={() => setNewOffer(true)}>+ Offer</button>}
        {tab === 'transactions' && <button className="btn btn-green" onClick={() => setNewTx(true)}>+ Progress tracker</button>}
        <button className="btn" onClick={load}><I name="refresh" size={13} /> Refresh</button>
      </ScreenHead>

      <div className="row" style={{ gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
        {TABS.map((t) => <button key={t.key} className={`btn btn-sm${tab === t.key ? ' btn-green' : ''}`} onClick={() => setTab(t.key)}>{t.label}</button>)}
      </div>
      {err && <div className="card" style={{ borderColor: 'var(--red)', color: 'var(--red)', marginBottom: 12 }}>{err}</div>}
      {loading && <div className="muted">Loading…</div>}
      {!loading && !rows.length && (
        <div className="card" style={{ textAlign: 'center', padding: 30 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Nothing here yet</div>
          <div className="muted">
            {tab === 'documents' && 'Customers request documents from their account. Edit what you offer under Website.'}
            {tab === 'services' && 'Landlord and valuation submissions from your website appear here.'}
            {tab === 'offers' && 'Create an offer to send a customer a written price and terms.'}
            {tab === 'transactions' && 'Create a tracker so a customer can follow their purchase or tenancy.'}
          </div>
        </div>
      )}

      {!!rows.length && tab === 'documents' && (
        <Table head={['Ref', 'Customer', 'Document', 'Fee', 'Status', '']} rows={rows.map((r) => {
          const [cls, label] = DOC_TAG[r.status] || ['t-gray', r.status];
          return (
            <tr key={r.id} style={{ cursor: 'pointer' }} onClick={async () => { try { setOpen({ kind: 'doc', data: await api.docRequests.get(r.id) }); } catch (e: any) { setErr(e.message); } }}>
              <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{r.reference}<div className="muted">{timeAgo(r.created_at)}</div></td>
              <td><div style={{ fontWeight: 600 }}>{r.client?.name}</div><div className="muted">{r.client?.verified_phone || r.client?.verified_email}</div></td>
              <td>{r.doc_label}{r.property && <div className="muted">{r.property.title}</div>}</td>
              <td>{r.fee > 0 ? fmtGHS(r.fee) : 'Free'}</td>
              <td><span className={`tag ${cls}`}>{label}</span></td>
              <td><button className="btn btn-sm">Open</button></td>
            </tr>
          );
        })} />
      )}

      {!!rows.length && tab === 'services' && (
        <Table head={['Ref', 'From', 'Service', 'Details', 'Status', '']} rows={rows.map((r) => {
          const [cls, label] = SVC_TAG[r.status] || ['t-gray', r.status];
          return (
            <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => setOpen({ kind: 'svc', data: r })}>
              <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{r.reference}<div className="muted">{timeAgo(r.created_at)}</div></td>
              <td><div style={{ fontWeight: 600 }}>{r.name}</div><div className="muted">{r.phone || r.email}</div></td>
              <td>{r.kind_label}</td>
              <td style={{ maxWidth: 240, fontSize: 12, color: 'var(--text-secondary)' }}>{Object.entries(r.details || {}).slice(0, 3).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`).join(' · ')}</td>
              <td><span className={`tag ${cls}`}>{label}</span>{r.converted && <div className="muted">draft created</div>}</td>
              <td><button className="btn btn-sm">Open</button></td>
            </tr>
          );
        })} />
      )}

      {!!rows.length && tab === 'offers' && (
        <Table head={['Ref', 'Customer', 'Property', 'Amount', 'Status', '']} rows={rows.map((o) => {
          const [cls, label] = OFFER_TAG[o.effective_status] || ['t-gray', o.status];
          return (
            <tr key={o.id} style={{ cursor: 'pointer' }} onClick={() => setOpen({ kind: 'offer', data: o })}>
              <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{o.reference}<div className="muted">{timeAgo(o.created_at)}</div></td>
              <td>{o.client?.name}</td>
              <td>{o.property?.title}</td>
              <td style={{ fontWeight: 700 }}>{fmtGHS(o.amount)}</td>
              <td><span className={`tag ${cls}`}>{label}</span></td>
              <td><button className="btn btn-sm">Open</button></td>
            </tr>
          );
        })} />
      )}

      {!!rows.length && tab === 'transactions' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
          {rows.map((t) => {
            const done = (t.milestones || []).filter((m: any) => m.state === 'done').length;
            return (
              <div key={t.id} className="card" style={{ cursor: 'pointer' }} onClick={() => setOpen({ kind: 'tx', data: t })}>
                <div className="spread" style={{ marginBottom: 6 }}>
                  <div style={{ fontWeight: 700, fontSize: 13.5 }}>{t.client?.name}</div>
                  <span className={`tag ${t.status === 'completed' ? 't-green' : t.status === 'cancelled' ? 't-gray' : 't-blue'}`}>{t.kind}</span>
                </div>
                <div className="muted" style={{ marginBottom: 8 }}>{t.property?.title || 'No property linked'} · {t.reference}</div>
                <div className="progress" style={{ marginBottom: 6 }}><div style={{ width: `${(t.milestones || []).length ? (done / t.milestones.length) * 100 : 0}%` }} /></div>
                <div className="muted">{done} of {(t.milestones || []).length} steps done</div>
              </div>
            );
          })}
        </div>
      )}

      {open?.kind === 'doc' && <DocModal r={open.data} onClose={() => setOpen(null)} run={run} err={err} />}
      {open?.kind === 'svc' && <SvcModal r={open.data} isManager={isManager} onClose={() => setOpen(null)} run={run} err={err} />}
      {open?.kind === 'offer' && <OfferModal o={open.data} isManager={isManager} onClose={() => setOpen(null)} run={run} err={err} />}
      {open?.kind === 'tx' && <TxModal t={open.data} onClose={() => setOpen(null)} run={run} err={err} />}
      {newOffer && <NewOffer onClose={() => setNewOffer(false)} run={run} err={err} />}
      {newTx && <NewTx onClose={() => setNewTx(false)} run={run} err={err} />}
    </div>
  );
}

const Table = ({ head, rows }: { head: string[]; rows: React.ReactNode }) => (
  <div className="card table-wrap" style={{ padding: 0 }}>
    <table className="table"><thead><tr>{head.map((h, i) => <th key={i}>{h}</th>)}</tr></thead><tbody>{rows}</tbody></table>
  </div>
);
const Err = ({ err }: { err: string }) => (err ? <div style={{ color: 'var(--red)', fontSize: 12, marginBottom: 10 }}>{err}</div> : null);

function DocModal({ r, onClose, run, err }: any) {
  const [status, setStatus] = useState('');
  const [message, setMessage] = useState('');
  const [note, setNote] = useState(r.staff_note || '');
  const [busy, setBusy] = useState(false);
  const next = { requested: ['in_progress', 'ready', 'declined'], in_progress: ['ready', 'declined'], ready: ['in_progress'], declined: ['in_progress'], cancelled: [] }[r.status as string] || [];
  const upload = async (f?: File) => {
    if (!f) return; setBusy(true);
    try { await api.docRequests.upload(r.id, { file_name: f.name, content_base64: await toBase64(f) }); await run(async () => {}); location.reload(); } finally { setBusy(false); }
  };
  const openFile = async (fileId: string) => {
    const w = window.open('', '_blank'); if (w) w.opener = null;
    try { const x = await api.docRequests.fileUrl(r.id, fileId); if (w) w.location.href = x.url; } catch { w?.close(); }
  };
  return (
    <Modal title={`${r.reference} — ${r.doc_label}`} onClose={onClose}>
      <Err err={err} />
      <div className="muted" style={{ marginBottom: 10 }}>{r.client?.name} · {r.client?.verified_phone || r.client?.verified_email}{r.property ? ` · ${r.property.title}` : ''}</div>
      {r.customer_note && <div style={{ fontSize: 13, marginBottom: 10 }}>Customer note: “{r.customer_note}”</div>}
      <div className="section-title" style={{ marginTop: 0 }}>Issued documents</div>
      {r.files?.length ? r.files.map((f: any) => (
        <div key={f.id} className="spread" style={{ fontSize: 13, marginBottom: 6 }}>
          <span><I name="doc" size={13} /> {f.label || f.file_name} <span className="muted">· {kb(f.size_bytes)}</span></span>
          <button className="btn btn-sm" onClick={() => openFile(f.id)}>View</button>
        </div>
      )) : <div className="muted">None uploaded yet.</div>}
      <label className="btn btn-sm" style={{ marginTop: 8, cursor: busy ? 'wait' : 'pointer' }}>
        <I name="upload" size={13} /> {busy ? 'Uploading…' : 'Upload document'}
        <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" style={{ display: 'none' }} disabled={busy} onChange={(e) => upload(e.target.files?.[0])} />
      </label>
      {next.length > 0 && (
        <>
          <div className="section-title">Update status</div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
            {next.map((sx: string) => <button key={sx} className={`btn btn-sm${status === sx ? ' btn-green' : ''}`} onClick={() => setStatus(sx)}>{DOC_TAG[sx][1]}</button>)}
          </div>
          {status && (
            <>
              <div className="form-group"><label className="form-label">Message to the customer {status === 'declined' ? '*' : '(optional)'}</label>
                <textarea className="form-input" rows={2} value={message} onChange={(e) => setMessage(e.target.value)} /></div>
              <button className="btn btn-green btn-block" onClick={() => run(() => api.docRequests.setStatus(r.id, { status, message: message || undefined }))}>Set to “{DOC_TAG[status][1]}”</button>
            </>
          )}
        </>
      )}
      <div className="section-title">Internal note</div>
      <textarea className="form-input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Never shown to the customer" />
      <button className="btn btn-sm" style={{ marginTop: 6 }} onClick={() => run(() => api.docRequests.note(r.id, note))}>Save note</button>
    </Modal>
  );
}

function SvcModal({ r, isManager, onClose, run, err }: any) {
  const [status, setStatus] = useState('');
  const [message, setMessage] = useState('');
  const [note, setNote] = useState(r.staff_note || '');
  return (
    <Modal title={`${r.reference} — ${r.kind_label}`} onClose={onClose}>
      <Err err={err} />
      <div className="muted" style={{ marginBottom: 10 }}>{r.name} · {r.phone || r.email} · lead {r.lead?.name} ({r.lead?.stage})</div>
      <div className="section-title" style={{ marginTop: 0 }}>Submitted details</div>
      {Object.entries(r.details || {}).map(([k, v]) => <div key={k} style={{ fontSize: 13, marginBottom: 4 }}><span className="muted">{k.replace(/_/g, ' ')}:</span> {String(v)}</div>)}
      {r.converted && <div className="muted" style={{ marginTop: 10 }}>Draft listing created: {r.converted.title} ({r.converted.listing_status})</div>}
      {isManager && r.kind === 'list_property' && !r.converted_property_id && (
        <button className="btn btn-green btn-block" style={{ marginTop: 12 }} onClick={() => run(() => api.serviceRequests.convert(r.id))}>
          <I name="plus" size={13} /> Create draft listing from this
        </button>
      )}
      <div className="section-title">Update status</div>
      <div className="row" style={{ gap: 6, marginBottom: 10 }}>
        {['new', 'in_progress', 'closed'].map((sx) => <button key={sx} className={`btn btn-sm${status === sx ? ' btn-green' : ''}`} onClick={() => setStatus(sx)}>{SVC_TAG[sx][1]}</button>)}
      </div>
      {status && (
        <>
          <div className="form-group"><label className="form-label">Reply to the customer (optional — appears on their tracking page)</label>
            <textarea className="form-input" rows={2} value={message} onChange={(e) => setMessage(e.target.value)} /></div>
          <button className="btn btn-green btn-block" onClick={() => run(() => api.serviceRequests.setStatus(r.id, { status, message: message || undefined }))}>Save</button>
        </>
      )}
      <div className="section-title">Internal note</div>
      <textarea className="form-input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      <button className="btn btn-sm" style={{ marginTop: 6 }} onClick={() => run(() => api.serviceRequests.note(r.id, note))}>Save note</button>
    </Modal>
  );
}

function OfferModal({ o, isManager, onClose, run, err }: any) {
  return (
    <Modal title={`${o.reference} — ${fmtGHS(o.amount)}`} onClose={onClose}>
      <Err err={err} />
      <div className="muted" style={{ marginBottom: 10 }}>{o.client?.name} · {o.property?.title} · created by {o.creator?.name || '—'}</div>
      <div style={{ fontSize: 13, marginBottom: 10, whiteSpace: 'pre-line' }}>{o.terms || <span className="muted">No terms written.</span>}</div>
      {o.expires_at && <div className="muted" style={{ marginBottom: 6 }}>Respond by {new Date(o.expires_at).toLocaleDateString('en-GB')}</div>}
      {o.responded_at && <div style={{ fontSize: 13, marginBottom: 10 }}>Customer {o.status} on {new Date(o.responded_at).toLocaleDateString('en-GB')}{o.customer_response_note ? `: “${o.customer_response_note}”` : ''}</div>}
      {isManager && (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          {o.status === 'draft' && <button className="btn btn-green" onClick={() => run(() => api.offers.send(o.id))}><I name="send" size={13} /> Send to customer</button>}
          {['draft', 'sent'].includes(o.status) && <button className="btn btn-red" onClick={() => run(() => api.offers.withdraw(o.id))}>Withdraw</button>}
        </div>
      )}
      <div className="muted" style={{ marginTop: 12 }}>Accepting an offer records the customer's intent. It is not a contract — nothing is binding until an agreement is signed.</div>
    </Modal>
  );
}

function NewOffer({ onClose, run, err }: any) {
  const [f, setF] = useState<any>({ client_id: '', property_id: '', amount: '', terms: '', expires_at: '' });
  const [clients, setClients] = useState<any[]>([]);
  const [props, setProps] = useState<any[]>([]);
  useEffect(() => { api.misc.clients().then(setClients).catch(() => {}); api.marketing.listings().then(setProps).catch(() => {}); }, []);
  return (
    <Modal title="New offer" onClose={onClose}>
      <Err err={err} />
      <form onSubmit={(e) => { e.preventDefault(); run(() => api.offers.create({ ...f, amount: Number(f.amount), expires_at: f.expires_at || undefined })); }}>
        <div className="form-group"><label className="form-label">Customer *</label>
          <select className="form-select" required value={f.client_id} onChange={(e) => setF({ ...f, client_id: e.target.value })}>
            <option value="">Choose…</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select></div>
        <div className="form-group"><label className="form-label">Property *</label>
          <select className="form-select" required value={f.property_id} onChange={(e) => setF({ ...f, property_id: e.target.value })}>
            <option value="">Choose…</option>{props.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select></div>
        <div className="row" style={{ gap: 10 }}>
          <div className="form-group" style={{ flex: 1 }}><label className="form-label">Amount (GHS) *</label>
            <input className="form-input" type="number" min={0} required value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></div>
          <div className="form-group" style={{ flex: 1 }}><label className="form-label">Respond by</label>
            <input className="form-input" type="date" value={f.expires_at} onChange={(e) => setF({ ...f, expires_at: e.target.value })} /></div>
        </div>
        <div className="form-group"><label className="form-label">Terms shown to the customer</label>
          <textarea className="form-input" rows={4} value={f.terms} onChange={(e) => setF({ ...f, terms: e.target.value })} placeholder="Deposit, payment schedule, what is included…" /></div>
        <button className="btn btn-green btn-block">Create as draft</button>
        <div className="muted" style={{ marginTop: 8 }}>Drafts are not visible to the customer until you send them.</div>
      </form>
    </Modal>
  );
}

function TxModal({ t, onClose, run, err }: any) {
  const [ms, setMs] = useState<any[]>(t.milestones || []);
  const [message, setMessage] = useState(t.customer_message || '');
  const set = (i: number, patch: any) => setMs(ms.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  return (
    <Modal title={`${t.reference} — ${t.client?.name}`} onClose={onClose}>
      <Err err={err} />
      <div className="muted" style={{ marginBottom: 10 }}>{t.property?.title || 'No property linked'} · {t.kind}</div>
      {ms.map((m, i) => (
        <div key={m.key} className="row" style={{ gap: 8, marginBottom: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="form-group" style={{ flex: '2 1 160px', marginBottom: 0 }}><label className="form-label">{m.label}</label>
            <input className="form-input" value={m.note || ''} placeholder="Note shown to the customer" onChange={(e) => set(i, { note: e.target.value })} /></div>
          <div className="form-group" style={{ flex: '1 1 120px', marginBottom: 0 }}>
            <select className="form-select" value={m.state} onChange={(e) => set(i, { state: e.target.value })}>
              {[['pending', 'Not started'], ['in_progress', 'In progress'], ['done', 'Done'], ['blocked', 'On hold']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select></div>
        </div>
      ))}
      <div className="form-group" style={{ marginTop: 10 }}><label className="form-label">Message to the customer</label>
        <textarea className="form-input" rows={2} value={message} onChange={(e) => setMessage(e.target.value)} /></div>
      <button className="btn btn-green btn-block" onClick={() => run(() => api.transactions.update(t.id, { milestones: ms, customer_message: message }))}>Save progress</button>
      <div className="row" style={{ gap: 8, marginTop: 8 }}>
        <button className="btn btn-sm" onClick={() => run(() => api.transactions.update(t.id, { status: 'completed' }))}>Mark completed</button>
        <button className="btn btn-sm btn-red" onClick={() => run(() => api.transactions.update(t.id, { status: 'cancelled' }))}>Cancel</button>
      </div>
    </Modal>
  );
}

function NewTx({ onClose, run, err }: any) {
  const [f, setF] = useState<any>({ client_id: '', property_id: '', kind: 'rental' });
  const [clients, setClients] = useState<any[]>([]);
  const [props, setProps] = useState<any[]>([]);
  useEffect(() => { api.misc.clients().then(setClients).catch(() => {}); api.marketing.listings().then(setProps).catch(() => {}); }, []);
  return (
    <Modal title="New progress tracker" onClose={onClose}>
      <Err err={err} />
      <form onSubmit={(e) => { e.preventDefault(); run(() => api.transactions.create({ ...f, property_id: f.property_id || undefined })); }}>
        <div className="form-group"><label className="form-label">Customer *</label>
          <select className="form-select" required value={f.client_id} onChange={(e) => setF({ ...f, client_id: e.target.value })}>
            <option value="">Choose…</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select></div>
        <div className="form-group"><label className="form-label">Property</label>
          <select className="form-select" value={f.property_id} onChange={(e) => setF({ ...f, property_id: e.target.value })}>
            <option value="">None</option>{props.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select></div>
        <div className="form-group"><label className="form-label">Type</label>
          <select className="form-select" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
            <option value="rental">Rental</option><option value="sale">Sale</option>
          </select></div>
        <button className="btn btn-green btn-block">Create with default steps</button>
      </form>
    </Modal>
  );
}
