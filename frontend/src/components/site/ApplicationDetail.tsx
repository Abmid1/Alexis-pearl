'use client';
import { useEffect, useState } from 'react';
import { I } from '@/components/Icons';
import SignIn from './SignIn';
import { accountApi, fileToBase64, session } from './session';

const fmtDate = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Accra' });
const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp';

/** One application: status, the agency's message, requested documents, secure uploads. */
export default function ApplicationDetail({ slug, companyName, id }: { slug: string; companyName: string; id: string }) {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [a, setA] = useState<any>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState('');
  const [fresh, setFresh] = useState(false);

  const load = async () => {
    try { setA((await accountApi(slug, `/applications/${id}`)).application); setSignedIn(true); }
    catch (e: any) { if (e.status === 401) setSignedIn(false); else setErr(e.message); }
  };
  useEffect(() => {
    setFresh(new URLSearchParams(window.location.search).has('new'));
    if (session.get(slug)) load(); else setSignedIn(false);
  }, [slug, id]);

  if (signedIn === null) return <p className="s-hint">Loading…</p>;
  if (!signedIn) return <SignIn slug={slug} companyName={companyName} onDone={load} />;
  if (!a) return <div className="s-empty"><p>{err || 'Loading…'}</p></div>;

  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { setErr('That file is larger than 8 MB.'); return; }
    setBusy(true); setErr('');
    try {
      await accountApi(slug, `/applications/${id}/documents`, { method: 'POST', body: { file_name: file.name, label, content_base64: await fileToBase64(file) } });
      setLabel(''); await load();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const open = async (docId: string) => {
    const w = window.open('', '_blank');           // opened synchronously so pop-up blockers allow it
    if (w) w.opener = null;
    try { const r = await accountApi(slug, `/applications/${id}/documents/${docId}`); if (w) w.location.href = r.url; else window.location.href = r.url; }
    catch (e: any) { w?.close(); setErr(e.message); }
  };
  const withdraw = async () => {
    if (!confirm('Withdraw this application? You can apply again later.')) return;
    try { setA((await accountApi(slug, `/applications/${id}/withdraw`, { method: 'POST' })).application); } catch (e: any) { setErr(e.message); }
  };
  const good = ['approved'].includes(a.status); const bad = ['declined', 'withdrawn'].includes(a.status);

  return (
    <div className="s-timeline" style={{ maxWidth: 720 }}>
      {fresh && a.status === 'submitted' && <div className="s-success" role="status"><b>Application sent.</b> {companyName} will review it. Your reference is {a.reference}.</div>}
      {err && <div className="s-error" role="alert">{err}</div>}
      <div className="s-status-card">
        <div className="s-hint">Ref {a.reference} · submitted {fmtDate(a.created_at)}</div>
        <div style={{ fontWeight: 650, fontSize: 18 }}>{a.kind === 'rental' ? 'Rental' : 'Purchase'} application{a.property ? ` — ${a.property.title}` : ''}</div>
        <div className="s-status"><span className={`s-dot ${good ? '' : bad ? 'bad' : 'warn'}`} /> <b>{a.status_label}</b> · updated {fmtDate(a.updated_at)}</div>
        <p className="s-hint" style={{ fontSize: 15 }}>{a.next_step}</p>
        {a.customer_message && <div className="s-note"><b>Message from {companyName}:</b> {a.customer_message}</div>}
      </div>

      {a.requested_documents.length > 0 && a.can_upload && (
        <div className="s-status-card">
          <b>Documents requested</b>
          <ul style={{ paddingLeft: 18 }}>{a.requested_documents.map((d: any) => <li key={d.label}>{d.label}</li>)}</ul>
        </div>
      )}

      <div className="s-panel">
        <h2 style={{ fontSize: 18, marginBottom: 12 }}>Your documents</h2>
        {a.documents.length ? (
          <div className="s-contact-list">
            {a.documents.map((d: any) => (
              <div key={d.id} style={{ justifyContent: 'space-between' }}>
                <span style={{ display: 'flex', gap: 10, alignItems: 'center', minWidth: 0 }}><I name="doc" size={18} />
                  <span style={{ minWidth: 0 }}><span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.label || d.file_name}</span>
                    <small className="s-hint">{d.file_name} · {kb(d.size_bytes)} · {d.uploaded_by === 'customer' ? 'you' : companyName}</small></span></span>
                <button className="s-btn s-btn-ghost s-btn-sm" onClick={() => open(d.id)}>Open</button>
              </div>
            ))}
          </div>
        ) : <p className="s-hint">No documents uploaded.</p>}
        {a.can_upload && (
          <div style={{ marginTop: 16, display: 'grid', gap: 10 }}>
            <label className="s-field" style={{ margin: 0 }}><span>What is this document?</span>
              <input className="s-input" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={120} list="req-docs" placeholder="e.g. Ghana Card" />
              <datalist id="req-docs">{a.requested_documents.map((d: any) => <option key={d.label} value={d.label} />)}</datalist></label>
            <label className="s-btn s-btn-primary" style={{ justifySelf: 'start', cursor: busy ? 'wait' : 'pointer' }}>
              <I name="upload" size={18} /> {busy ? 'Uploading…' : 'Upload a file'}
              <input type="file" accept={ACCEPT} className="s-sr" disabled={busy} onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }} />
            </label>
            <p className="s-hint">PDF, JPG, PNG or WebP, up to 8 MB. Files are stored privately and only you and {companyName} can open them.</p>
          </div>
        )}
      </div>

      {a.answers?.length > 0 && (
        <div className="s-panel">
          <h2 style={{ fontSize: 18, marginBottom: 12 }}>Your answers</h2>
          <dl className="s-contact-list">{a.answers.map((x: any) => <div key={x.label} style={{ display: 'grid', gap: 2 }}><dt className="s-hint">{x.label}</dt><dd>{String(x.value)}</dd></div>)}</dl>
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <a className="s-btn s-btn-ghost" href={`/s/${slug}/account?tab=applications`}><I name="chevronLeft" size={16} /> All applications</a>
        {a.can_withdraw && <button className="s-btn s-btn-quiet" onClick={withdraw}>Withdraw application</button>}
      </div>
    </div>
  );
}
