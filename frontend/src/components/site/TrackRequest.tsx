'use client';
import { useEffect, useState } from 'react';
import { PUBLIC_API } from '@/lib/publicApi';
import { I } from '@/components/Icons';
import { lastRef } from './store';

const TZ = 'Africa/Accra';
const fmt = (iso: string) => new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: TZ });

/**
 * Customer status page. Access = reference + the phone/email used (checked server-side).
 * Nothing is stored in the URL except the non-secret reference.
 */
export default function TrackRequest({ slug, companyName, initialRef }: { slug: string; companyName: string; initialRef?: string }) {
  const [ref, setRef] = useState(initialRef || '');
  const [contact, setContact] = useState('');
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState('');
  const [moving, setMoving] = useState<any>(null);
  const [slots, setSlots] = useState<any[]>([]);

  useEffect(() => { if (!initialRef) setRef(lastRef.get(slug)); }, [slug, initialRef]);

  const post = async (path: string, body: any) => {
    const r = await fetch(`${PUBLIC_API}/api/public/${slug}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Something went wrong.');
    return j;
  };
  const lookup = async (e?: React.FormEvent) => {
    e?.preventDefault(); setBusy(true); setErr('');
    try { setData(await post('/requests/lookup', { reference: ref.trim(), contact: contact.trim() })); } catch (e: any) { setData(null); setErr(e.message); } finally { setBusy(false); }
  };
  const doAction = async (fn: () => Promise<any>) => {
    setBusy(true); setErr('');
    try { await fn(); setMoving(null); await lookup(); } catch (e: any) { setErr(e.message); setBusy(false); }
  };
  const startMove = async (v: any) => {
    setMoving(v); setSlots([]);
    const propId = data?.enquiry?.property?.id;
    if (!propId) return;
    const j = await fetch(`${PUBLIC_API}/api/public/${slug}/properties/${propId}/slots`, { cache: 'no-store' }).then((r) => r.json()).catch(() => ({}));
    setSlots(j.slots || []);
  };

  if (!data) {
    return (
      <form onSubmit={lookup} className="s-panel" style={{ maxWidth: 520 }}>
        {err && <div className="s-error" role="alert">{err}</div>}
        <label className="s-field"><span>Reference</span><input className="s-input" value={ref} onChange={(e) => setRef(e.target.value.toUpperCase())} placeholder="BA-7K3M9QX2" required autoCapitalize="characters" /></label>
        <label className="s-field"><span>Phone or email you used</span><input className="s-input" value={contact} onChange={(e) => setContact(e.target.value)} required autoComplete="tel email" /></label>
        <button className="s-btn s-btn-primary s-btn-block" disabled={busy}>{busy ? 'Checking…' : 'Check status'}</button>
        <p className="s-hint" style={{ marginTop: 10 }}>Lost your reference? Contact {companyName} directly.</p>
      </form>
    );
  }

  const e = data.enquiry;
  return (
    <div className="s-timeline" style={{ maxWidth: 720 }}>
      {err && <div className="s-error" role="alert">{err}</div>}
      <div className="s-status-card">
        <div className="s-hint">Reference {e.reference} · sent {fmt(e.created_at)}</div>
        <div style={{ fontWeight: 650, fontSize: 18 }}>{e.kind === 'viewing' ? 'Viewing request' : 'Enquiry'}{e.property ? ` — ${e.property.title}` : ''}</div>
        <div className="s-status"><span className="s-dot" /> {e.status_label}</div>
      </div>

      {data.viewings.map((v: any) => (
        <div key={v.id} className="s-status-card">
          <div className="s-status">
            <span className={`s-dot ${v.status === 'confirmed' || v.status === 'completed' ? '' : v.status === 'requested' ? 'warn' : 'bad'}`} />
            <b>{v.status_label}</b> · {fmt(v.starts_at)} (Ghana time)
          </div>
          <p className="s-hint" style={{ fontSize: 14.5 }}>{v.next_step}</p>
          {v.agent_name && <p style={{ fontSize: 14.5 }}>Your agent: <b>{v.agent_name}</b></p>}
          {v.decline_reason && <p style={{ fontSize: 14.5 }}>Message from {companyName}: {v.decline_reason}</p>}
          {(v.can_change || v.status === 'declined') && moving?.id !== v.id && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
              <button className="s-btn s-btn-ghost s-btn-sm" onClick={() => startMove(v)}>{v.status === 'declined' ? 'Pick another time' : 'Change time'}</button>
              {v.can_change && <button className="s-btn s-btn-quiet" onClick={() => { if (confirm('Cancel this viewing?')) doAction(() => post(`/requests/${e.reference}/viewings/${v.id}/cancel`, { contact })); }}>Cancel viewing</button>}
            </div>
          )}
          {moving?.id === v.id && (
            <div style={{ marginTop: 8 }}>
              {!slots.length ? <p className="s-hint">Loading times… if none appear, send {companyName} a message below.</p> : (
                <div className="s-times">
                  {slots.slice(0, 24).map((s) => (
                    <button type="button" key={s.starts_at} onClick={() => doAction(() => post(`/requests/${e.reference}/viewings/${v.id}/reschedule`, { contact, starts_at: s.starts_at }))}>{fmt(s.starts_at)}</button>
                  ))}
                </div>
              )}
              <button className="s-btn s-btn-quiet" onClick={() => setMoving(null)}>Keep current time</button>
            </div>
          )}
        </div>
      ))}

      <div className="s-panel">
        <h2 style={{ fontSize: 18, marginBottom: 12 }}>Messages with {companyName}</h2>
        <div className="s-thread">
          {data.messages.length ? data.messages.map((m: any, i: number) => (
            <div key={i} className={`s-msg ${m.from === 'you' ? 'you' : 'agency'}`}>{m.body}<time>{m.from === 'you' ? 'You' : companyName} · {fmt(m.at)}</time></div>
          )) : <p className="s-hint">No replies yet. Agents usually respond within one working day.</p>}
        </div>
        <form style={{ display: 'flex', gap: 8, marginTop: 14 }} onSubmit={(ev) => { ev.preventDefault(); if (reply.trim()) doAction(() => post(`/requests/${e.reference}/messages`, { contact, body: reply })).then(() => setReply('')); }}>
          <label className="s-sr" htmlFor="s-reply">Reply</label>
          <input id="s-reply" className="s-input" value={reply} onChange={(ev) => setReply(ev.target.value)} placeholder="Write a reply…" maxLength={2000} />
          <button className="s-btn s-btn-primary" disabled={busy || !reply.trim()} aria-label="Send reply"><I name="send" size={18} /></button>
        </form>
      </div>
      <button className="s-btn s-btn-quiet" onClick={() => { setData(null); setContact(''); }}>Check a different request</button>
    </div>
  );
}
