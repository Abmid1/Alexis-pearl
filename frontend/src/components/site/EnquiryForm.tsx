'use client';
import { useRef, useState } from 'react';
import { PUBLIC_API } from '@/lib/publicApi';
import { I } from '@/components/Icons';
import { lastRef, newIdempotencyKey } from './store';

/**
 * Enquiry form → POST /api/public/:slug/enquiries → CRM lead + inbox conversation.
 * Server validates everything; client checks are only for convenience.
 */
export default function EnquiryForm({ slug, companyName, propertyId, propertyTitle, compact = false }: {
  slug: string; companyName: string; propertyId?: string; propertyTitle?: string; compact?: boolean;
}) {
  const key = useRef(newIdempotencyKey());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState<string | null>(null);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const body = {
      property_id: propertyId, name: fd.get('name'), phone: fd.get('phone'), email: fd.get('email'),
      message: fd.get('message'), consent: fd.get('consent') === 'on', website: fd.get('website'),
      idempotency_key: key.current,
    };
    if (!body.phone && !body.email) { setErr('Please add a phone number or email so the agency can reply.'); return; }
    setBusy(true); setErr('');
    try {
      const r = await fetch(`${PUBLIC_API}/api/public/${slug}/enquiries`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Something went wrong. Please try again.');
      if (j.reference) lastRef.set(slug, j.reference);
      setDone(j.reference || '');
    } catch (e: any) {
      setErr(e.message === 'Failed to fetch' ? 'You seem to be offline. Please check your connection and try again.' : e.message);
    } finally { setBusy(false); }
  };

  if (done !== null) {
    return (
      <div className="s-success" role="status">
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', fontWeight: 650, marginBottom: 6 }}><I name="check" size={20} /> Enquiry sent to {companyName}</div>
        <p style={{ fontSize: 15 }}>An agent will get back to you. {done && <>Your reference is <b>{done}</b> — use it with your phone or email to see replies.</>}</p>
        {done && <a className="s-btn s-btn-ghost s-btn-sm" style={{ marginTop: 12 }} href={`/s/${slug}/track?ref=${encodeURIComponent(done)}`}>Check replies</a>}
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate={false} aria-label={propertyTitle ? `Enquire about ${propertyTitle}` : 'Send an enquiry'}>
      {err && <div className="s-error" role="alert">{err}</div>}
      <label className="s-field"><span>Your name</span><input className="s-input" name="name" required minLength={2} maxLength={80} autoComplete="name" /></label>
      <div className={compact ? '' : 's-row2'}>
        <label className="s-field"><span>Phone / WhatsApp</span><input className="s-input" name="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="024 000 0000" maxLength={32} /></label>
        <label className="s-field"><span>Email</span><input className="s-input" name="email" type="email" autoComplete="email" maxLength={254} /></label>
      </div>
      <label className="s-field"><span>Message</span>
        <textarea className="s-textarea" name="message" maxLength={2000} rows={compact ? 3 : 4}
          defaultValue={propertyTitle ? `Hello, I'm interested in "${propertyTitle}". Is it still available?` : ''} /></label>
      {/* honeypot — hidden from people, bots fill it in */}
      <label className="s-sr" aria-hidden="true">Website<input name="website" tabIndex={-1} autoComplete="off" /></label>
      <label className="s-check"><input type="checkbox" name="consent" /> <span>{companyName} may send me updates about this enquiry by WhatsApp, SMS or email.</span></label>
      <button className="s-btn s-btn-primary s-btn-block" disabled={busy}>{busy ? 'Sending…' : 'Send enquiry'}</button>
      <p className="s-hint" style={{ marginTop: 10 }}>Your details go only to {companyName}. They are not shared with other agencies.</p>
    </form>
  );
}
