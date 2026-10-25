'use client';
import { useEffect, useState } from 'react';
import { I } from '@/components/Icons';
import { accountApi } from './session';
import { newIdempotencyKey } from './store';

const date = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Accra' });
const money = (n: number) => (n > 0 ? `GHS ${Number(n).toLocaleString('en-GH')}` : 'Free');
const CAT: Record<string, string> = { financial: 'Financial', legal: 'Legal', construction: 'Construction', other: 'Other' };

/** Request official documents from the agency and open the ones they issue. */
export default function CustomerDocuments({ slug, companyName, onError }: { slug: string; companyName: string; onError: (t: string) => void }) {
  const [data, setData] = useState<any>(null);
  const [picked, setPicked] = useState<any>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => accountApi(slug, '/documents').then(setData).catch((e: any) => onError(e.message));
  useEffect(() => { load(); }, [slug]);
  if (!data) return <p className="s-hint">Loading…</p>;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    try {
      await accountApi(slug, '/documents', { method: 'POST', body: { doc_key: picked.key, note, idempotency_key: newIdempotencyKey() } });
      setPicked(null); setNote(''); await load();
    } catch (e: any) { onError(e.message); } finally { setBusy(false); }
  };
  const open = async (reqId: string, fileId: string) => {
    const w = window.open('', '_blank'); if (w) w.opener = null;
    try { const r = await accountApi(slug, `/documents/${reqId}/files/${fileId}`); if (w) w.location.href = r.url; }
    catch (e: any) { w?.close(); onError(e.message); }
  };
  const cancel = async (id: string) => {
    if (!confirm('Cancel this document request?')) return;
    try { await accountApi(slug, `/documents/${id}/cancel`, { method: 'POST' }); await load(); } catch (e: any) { onError(e.message); }
  };

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <section>
        <h2 style={{ fontSize: 18, marginBottom: 4 }}>Request a document</h2>
        <p className="s-hint" style={{ marginBottom: 14 }}>{companyName} prepares these by hand. Times shown are their usual turnaround, not a guarantee.</p>
        {data.catalogue.length ? (
          <div className="s-grid">
            {data.catalogue.map((d: any) => (
              <div key={d.key} className="s-card" style={{ padding: 16, display: 'grid', gap: 8 }}>
                <span className="s-badge" style={{ justifySelf: 'start' }}>{CAT[d.category] || 'Other'}</span>
                <b style={{ fontSize: 15.5 }}>{d.label}</b>
                {d.description && <span className="s-hint">{d.description}</span>}
                <div className="s-facts">
                  {d.turnaround_days != null && <span><I name="clock" size={14} /> {d.turnaround_days} days</span>}
                  <span><I name="wallet" size={14} /> {money(d.fee)}</span>
                </div>
                <button className="s-btn s-btn-ghost s-btn-sm" onClick={() => { setPicked(d); setNote(''); }}>Request</button>
              </div>
            ))}
          </div>
        ) : <div className="s-empty"><p>{companyName} hasn't published any documents you can request yet.</p></div>}
      </section>

      {picked && (
        <form className="s-panel" onSubmit={submit} style={{ display: 'grid', gap: 10 }}>
          <b>Request “{picked.label}”</b>
          <span className="s-hint">{money(picked.fee)}{picked.turnaround_days != null ? ` · usually ${picked.turnaround_days} days` : ''}. {picked.fee > 0 ? 'The agency will tell you how to pay the fee.' : ''}</span>
          <label className="s-field" style={{ margin: 0 }}><span>Anything the agency should know? (optional)</span>
            <textarea className="s-textarea" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} rows={2} /></label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="s-btn s-btn-primary" disabled={busy}>{busy ? 'Sending…' : 'Send request'}</button>
            <button type="button" className="s-btn s-btn-quiet" onClick={() => setPicked(null)}>Cancel</button>
          </div>
        </form>
      )}

      <section>
        <h2 style={{ fontSize: 18, marginBottom: 12 }}>My requests</h2>
        {data.requests.length ? (
          <div className="s-timeline">
            {data.requests.map((r: any) => (
              <div key={r.id} className="s-status-card">
                <div className="s-hint">Ref {r.reference} · {date(r.created_at)}{r.fee > 0 ? ` · ${money(r.fee)}` : ''}</div>
                <div style={{ fontWeight: 650, fontSize: 16 }}>{r.document}{r.property ? ` — ${r.property.title}` : ''}</div>
                <div className="s-status"><span className={`s-dot ${r.status === 'ready' ? '' : r.status === 'declined' || r.status === 'cancelled' ? 'bad' : 'warn'}`} /> <b>{r.status_label}</b></div>
                <span className="s-hint" style={{ fontSize: 14.5 }}>{r.next_step}</span>
                {r.customer_message && <div className="s-note">Message from {companyName}: {r.customer_message}</div>}
                {r.files.map((f: any) => (
                  <div key={f.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                    <span style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 0 }}><I name="doc" size={16} /> {f.label || f.file_name}</span>
                    <button className="s-btn s-btn-ghost s-btn-sm" onClick={() => open(r.id, f.id)}>Open</button>
                  </div>
                ))}
                {r.can_cancel && <button className="s-btn s-btn-quiet" style={{ justifySelf: 'start' }} onClick={() => cancel(r.id)}>Cancel request</button>}
              </div>
            ))}
          </div>
        ) : <p className="s-hint">You haven't requested any documents yet.</p>}
      </section>
    </div>
  );
}
