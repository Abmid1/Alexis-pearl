'use client';
import { useRef, useState } from 'react';
import { PUBLIC_API } from '@/lib/publicApi';
import { I } from '@/components/Icons';
import { lastRef, newIdempotencyKey } from './store';
import { session } from './session';

type Field = { key: string; label: string; type: string; required?: boolean; options?: string[] };
type Service = { key: string; label: string; blurb: string; fields: Field[] };

/** Landlord / owner service request. Works signed out; links to the account when signed in. */
export default function ServiceRequestForm({ slug, companyName, services }: { slug: string; companyName: string; services: Service[] }) {
  const key = useRef(newIdempotencyKey());
  const [chosen, setChosen] = useState<Service | null>(services.length === 1 ? services[0] : null);
  const [details, setDetails] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState<string | null>(null);

  if (done !== null) {
    return (
      <div className="s-success" role="status">
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', fontWeight: 650, marginBottom: 6 }}><I name="check" size={20} /> Sent to {companyName}</div>
        <p style={{ fontSize: 15 }}>An agent will be in touch. Your reference is <b>{done}</b>.</p>
        <a className="s-btn s-btn-ghost s-btn-sm" style={{ marginTop: 12 }} href={`/s/${slug}/track?ref=${encodeURIComponent(done)}`}>Track this request</a>
      </div>
    );
  }

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    if (!fd.get('phone') && !fd.get('email')) { setErr('Please add a phone number or email so the agency can reply.'); return; }
    setBusy(true); setErr('');
    try {
      const s = session.get(slug);
      const r = await fetch(`${PUBLIC_API}/api/public/${slug}/services`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(s ? { Authorization: `Bearer ${s.token}` } : {}) },
        body: JSON.stringify({
          kind: chosen!.key, name: fd.get('name'), phone: fd.get('phone'), email: fd.get('email'),
          message: fd.get('message'), consent: fd.get('consent') === 'on', website: fd.get('website'),
          details, idempotency_key: key.current,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Something went wrong. Please try again.');
      if (j.reference) lastRef.set(slug, j.reference);
      setDone(j.reference || '');
    } catch (e: any) {
      setErr(e.message === 'Failed to fetch' ? 'You seem to be offline. Please try again.' : e.message);
    } finally { setBusy(false); }
  };

  if (!chosen) {
    return (
      <div className="s-tiles">
        {services.map((sv) => (
          <button key={sv.key} className="s-tile" style={{ textAlign: 'left', cursor: 'pointer', font: 'inherit' }} onClick={() => { setChosen(sv); setDetails({}); }}>
            <span className="s-tile-icon"><I name={sv.key === 'valuation' ? 'chart' : sv.key === 'management' ? 'building' : sv.key === 'relocation' ? 'crane' : 'home'} size={19} /></span>
            <span><b>{sv.label}</b><br /><small>{sv.blurb}</small></span>
          </button>
        ))}
      </div>
    );
  }

  const set = (k: string, v: string) => setDetails((d) => ({ ...d, [k]: v }));
  return (
    <form className="s-panel" onSubmit={submit} style={{ maxWidth: 620 }} aria-label={chosen.label}>
      {services.length > 1 && <button type="button" className="s-btn s-btn-quiet" style={{ marginBottom: 8 }} onClick={() => setChosen(null)}><I name="chevronLeft" size={16} /> Choose another service</button>}
      <h2 style={{ fontSize: 22, marginBottom: 4 }}>{chosen.label}</h2>
      <p className="s-hint" style={{ fontSize: 15, marginBottom: 18 }}>{chosen.blurb} {companyName} will review your details and contact you.</p>
      {err && <div className="s-error" role="alert">{err}</div>}

      {chosen.fields.map((f) => (
        <label key={f.key} className="s-field">
          <span>{f.label}{f.required ? ' *' : ''}</span>
          {f.type === 'textarea' ? <textarea className="s-textarea" required={f.required} maxLength={2000} value={details[f.key] || ''} onChange={(e) => set(f.key, e.target.value)} />
            : f.type === 'select' ? (
              <select className="s-select" required={f.required} value={details[f.key] || ''} onChange={(e) => set(f.key, e.target.value)}>
                <option value="">Choose…</option>{(f.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
              </select>)
            : <input className="s-input" required={f.required} maxLength={300}
                type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'} min={f.type === 'number' ? 0 : undefined}
                inputMode={f.type === 'number' ? 'numeric' : undefined}
                value={details[f.key] || ''} onChange={(e) => set(f.key, e.target.value)} />}
        </label>
      ))}

      <hr style={{ border: 0, borderTop: '1px solid var(--s-line)', margin: '18px 0' }} />
      <label className="s-field"><span>Your name *</span><input className="s-input" name="name" required minLength={2} maxLength={80} autoComplete="name" /></label>
      <div className="s-row2">
        <label className="s-field"><span>Phone / WhatsApp</span><input className="s-input" name="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="024 000 0000" /></label>
        <label className="s-field"><span>Email</span><input className="s-input" name="email" type="email" autoComplete="email" /></label>
      </div>
      <label className="s-field"><span>Anything else? (optional)</span><textarea className="s-textarea" name="message" rows={2} maxLength={2000} /></label>
      <label className="s-sr" aria-hidden="true">Website<input name="website" tabIndex={-1} autoComplete="off" /></label>
      <label className="s-check"><input type="checkbox" name="consent" /> <span>{companyName} may contact me about this request by WhatsApp, SMS or email.</span></label>
      <button className="s-btn s-btn-primary s-btn-block" disabled={busy}>{busy ? 'Sending…' : `Send to ${companyName}`}</button>
      <p className="s-hint" style={{ marginTop: 10 }}>Sending this does not list, value or commit your property to anything. It starts a conversation with the agency.</p>
    </form>
  );
}
