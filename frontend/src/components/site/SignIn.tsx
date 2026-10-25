'use client';
import { useState } from 'react';
import { I } from '@/components/Icons';
import { accountApi, session } from './session';
import { saved } from './store';

/** Two-step sign-in: phone/email → 6-digit code. No passwords. */
export default function SignIn({ slug, companyName, onDone, intro }: { slug: string; companyName: string; onDone: () => void; intro?: string }) {
  const [step, setStep] = useState<'contact' | 'code'>('contact');
  const [contact, setContact] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const send = async (e?: React.FormEvent) => {
    e?.preventDefault(); setBusy(true); setErr('');
    try {
      const r = await accountApi(slug, '/code', { method: 'POST', body: { contact } });
      setSentTo(r.sent_to); setStep('code'); setCode('');
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const verify = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      const r = await accountApi(slug, '/verify', { method: 'POST', body: { contact, code: code.trim(), name } });
      session.set(slug, r.token, r.client.name);
      // bring over homes saved on this device before signing in
      const local = saved.list(slug);
      if (local.length) await accountApi(slug, '/saved/sync', { method: 'POST', body: { ids: local } }).catch(() => {});
      onDone();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="s-panel" style={{ maxWidth: 460 }}>
      <h2 style={{ fontSize: 22, marginBottom: 6 }}>{step === 'contact' ? `Sign in to ${companyName}` : 'Enter your code'}</h2>
      <p className="s-hint" style={{ fontSize: 15, marginBottom: 18 }}>
        {step === 'contact'
          ? intro || 'Use the phone number or email you gave the agency. We\'ll send a 6-digit code — no password needed.'
          : `We sent a code to ${sentTo}. It expires in 10 minutes.`}
      </p>
      {err && <div className="s-error" role="alert">{err}</div>}
      {step === 'contact' ? (
        <form onSubmit={send}>
          <label className="s-field"><span>Phone (WhatsApp) or email</span>
            <input className="s-input" value={contact} onChange={(e) => setContact(e.target.value)} required autoComplete="tel email" placeholder="024 000 0000 or you@example.com" /></label>
          <label className="s-field"><span>Your name <span className="s-hint">(first time only)</span></span>
            <input className="s-input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={80} /></label>
          <button className="s-btn s-btn-primary s-btn-block" disabled={busy || !contact.trim()}>{busy ? 'Sending…' : 'Send code'}</button>
        </form>
      ) : (
        <form onSubmit={verify}>
          <label className="s-field"><span>6-digit code</span>
            <input className="s-input" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" required
              style={{ fontSize: 24, letterSpacing: '0.3em', textAlign: 'center' }} autoFocus /></label>
          <button className="s-btn s-btn-primary s-btn-block" disabled={busy || code.length !== 6}>{busy ? 'Checking…' : 'Sign in'}</button>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, flexWrap: 'wrap', gap: 6 }}>
            <button type="button" className="s-btn s-btn-quiet" onClick={() => { setStep('contact'); setErr(''); }}><I name="chevronLeft" size={16} /> Change number</button>
            <button type="button" className="s-btn s-btn-quiet" onClick={() => send()} disabled={busy}>Send a new code</button>
          </div>
        </form>
      )}
      <p className="s-hint" style={{ marginTop: 14 }}>Only {companyName} sees your details. Signing in here doesn't create an account with any other agency.</p>
    </div>
  );
}
