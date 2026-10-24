'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { PUBLIC_API } from '@/lib/publicApi';
import { I } from '@/components/Icons';
import { lastRef, newIdempotencyKey } from './store';

type Slot = { starts_at: string; ends_at: string };
const TZ = 'Africa/Accra';
const dayKey = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ });
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', timeZone: TZ });
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: TZ });
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
const fmtFull = (iso: string) => new Date(iso).toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: TZ });

/**
 * Pick a slot from the agency's schedule and request a viewing.
 * The result is always "awaiting confirmation" — staff confirm in the workspace.
 */
export default function ViewingBooker({ slug, companyName, propertyId, propertyTitle }: { slug: string; companyName: string; propertyId: string; propertyTitle: string }) {
  const key = useRef(newIdempotencyKey());
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [closed, setClosed] = useState<string | null>(null);
  const [day, setDay] = useState('');
  const [pick, setPick] = useState<Slot | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState<{ reference: string; starts_at: string } | null>(null);

  const load = () => {
    setErr('');
    fetch(`${PUBLIC_API}/api/public/${slug}/properties/${propertyId}/slots`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => { if (!j.open) setClosed(j.reason || 'Viewings are not available for this property.'); setSlots(j.slots || []); })
      .catch(() => setErr('Could not load available times. Please check your connection.'));
  };
  useEffect(load, [slug, propertyId]);

  const days = useMemo(() => {
    const m = new Map<string, Slot[]>();
    (slots || []).forEach((s) => { const k = dayKey(s.starts_at); m.set(k, [...(m.get(k) || []), s]); });
    return Array.from(m.entries());
  }, [slots]);
  useEffect(() => { if (days.length && !day) setDay(days[0][0]); }, [days, day]);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!pick) { setErr('Choose a time first.'); return; }
    const fd = new FormData(e.currentTarget);
    if (!fd.get('phone') && !fd.get('email')) { setErr('Please add a phone number or email so the agency can confirm.'); return; }
    setBusy(true); setErr('');
    try {
      const r = await fetch(`${PUBLIC_API}/api/public/${slug}/viewings`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          property_id: propertyId, starts_at: pick.starts_at, name: fd.get('name'), phone: fd.get('phone'), email: fd.get('email'),
          message: fd.get('message'), consent: fd.get('consent') === 'on', website: fd.get('website'), idempotency_key: key.current,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.status === 409) { setPick(null); load(); }
      if (!r.ok) throw new Error(j.error || 'Something went wrong. Please try again.');
      if (j.reference) lastRef.set(slug, j.reference);
      setDone({ reference: j.reference, starts_at: pick.starts_at });
    } catch (e: any) {
      setErr(e.message === 'Failed to fetch' ? 'You seem to be offline. Please try again.' : e.message);
    } finally { setBusy(false); }
  };

  if (done) {
    return (
      <div className="s-success" role="status">
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', fontWeight: 650, marginBottom: 6 }}><I name="clock" size={20} /> Request sent — awaiting confirmation</div>
        <p style={{ fontSize: 15 }}>You asked to view on <b>{fmtFull(done.starts_at)}</b>. This is <b>not booked yet</b>: {companyName} will confirm the time or suggest another.</p>
        <p style={{ fontSize: 15, marginTop: 6 }}>Reference: <b>{done.reference}</b></p>
        <a className="s-btn s-btn-ghost s-btn-sm" style={{ marginTop: 12 }} href={`/s/${slug}/track?ref=${encodeURIComponent(done.reference)}`}>Track this request</a>
      </div>
    );
  }
  if (closed) return <div className="s-note">{closed} You can still send the agency a message.</div>;
  if (!slots) return <div className="s-hint">{err || 'Loading available times…'}</div>;
  if (!slots.length) return <div className="s-note">No viewing times are open in the next few weeks. Send an enquiry and {companyName} will arrange a time with you.</div>;

  const times = days.find(([k]) => k === day)?.[1] || [];
  return (
    <form onSubmit={submit} aria-label={`Request a viewing of ${propertyTitle}`}>
      {err && <div className="s-error" role="alert">{err}</div>}
      <span className="s-label" id="s-day-label">Choose a day</span>
      <div className="s-days" role="group" aria-labelledby="s-day-label" style={{ marginTop: 8 }}>
        {days.map(([k, list]) => (
          <button type="button" key={k} aria-pressed={k === day} onClick={() => { setDay(k); setPick(null); }}>
            <small>{fmtDay(list[0].starts_at)}</small><b>{fmtDate(list[0].starts_at).split(' ')[0]}</b><small>{fmtDate(list[0].starts_at).split(' ')[1]}</small>
          </button>
        ))}
      </div>
      <span className="s-label" id="s-time-label">Choose a time <span className="s-hint">(Ghana time)</span></span>
      <div className="s-times" role="group" aria-labelledby="s-time-label" style={{ marginTop: 8 }}>
        {times.map((s) => (
          <button type="button" key={s.starts_at} aria-pressed={pick?.starts_at === s.starts_at} onClick={() => setPick(s)}>{fmtTime(s.starts_at)}</button>
        ))}
      </div>
      {pick && (
        <>
          <label className="s-field"><span>Your name</span><input className="s-input" name="name" required minLength={2} maxLength={80} autoComplete="name" /></label>
          <label className="s-field"><span>Phone / WhatsApp</span><input className="s-input" name="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="024 000 0000" /></label>
          <label className="s-field"><span>Email (optional)</span><input className="s-input" name="email" type="email" autoComplete="email" /></label>
          <label className="s-field"><span>Questions or preferences (optional)</span><textarea className="s-textarea" name="message" rows={2} maxLength={2000} /></label>
          <label className="s-sr" aria-hidden="true">Website<input name="website" tabIndex={-1} autoComplete="off" /></label>
          <label className="s-check"><input type="checkbox" name="consent" /> <span>{companyName} may confirm this viewing by WhatsApp, SMS or email. (Without this, they'll call you or you can check the status here.)</span></label>
          <button className="s-btn s-btn-primary s-btn-block" disabled={busy}>{busy ? 'Sending…' : `Request ${fmtTime(pick.starts_at)}, ${fmtDate(pick.starts_at)}`}</button>
          <p className="s-hint" style={{ marginTop: 10 }}>The agency confirms every viewing. You'll see the status with your reference.</p>
        </>
      )}
    </form>
  );
}
