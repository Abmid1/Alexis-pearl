'use client';
import { useEffect, useRef, useState } from 'react';
import SignIn from './SignIn';
import { accountApi, session } from './session';
import { newIdempotencyKey } from './store';

type Q = { key: string; label: string; type: string; required: boolean; options?: string[] };

/** Application form built from the agency's own questions. Requires sign-in. */
export default function ApplyForm({ slug, companyName, propertyId, propertyTitle, kind }: { slug: string; companyName: string; propertyId: string; propertyTitle: string; kind: 'rental' | 'purchase' }) {
  const key = useRef(newIdempotencyKey());
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [form, setForm] = useState<Q[] | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = async () => {
    try { setForm((await accountApi(slug, '/form')).form); setSignedIn(true); }
    catch (e: any) { if (e.status === 401) setSignedIn(false); else setErr(e.message); }
  };
  useEffect(() => { if (session.get(slug)) load(); else setSignedIn(false); }, [slug]);

  if (signedIn === null) return <p className="s-hint">Loading…</p>;
  if (!signedIn) return <SignIn slug={slug} companyName={companyName} onDone={load} intro={`Sign in to apply for “${propertyTitle}”. Your application and any documents stay private between you and ${companyName}.`} />;
  if (!form) return <p className="s-hint">{err || 'Loading the application form…'}</p>;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      const r = await accountApi(slug, '/applications', { method: 'POST', body: { property_id: propertyId, answers, idempotency_key: key.current } });
      window.location.href = `/s/${slug}/account/applications/${r.application.id}?new=1`;
    } catch (e: any) {
      if (e.status === 409 && e.body?.application_id) { window.location.href = `/s/${slug}/account/applications/${e.body.application_id}`; return; }
      setErr(e.message); setBusy(false);
    }
  };
  const set = (k: string, v: string) => setAnswers((a) => ({ ...a, [k]: v }));

  return (
    <form className="s-panel" onSubmit={submit} style={{ maxWidth: 620 }}>
      <h2 style={{ fontSize: 22, marginBottom: 6 }}>{kind === 'rental' ? 'Rental' : 'Purchase'} application</h2>
      <p className="s-hint" style={{ fontSize: 15, marginBottom: 18 }}>
        For <b>{propertyTitle}</b>. {companyName} reviews every application and may ask for documents afterwards. Applying doesn't reserve the property or commit you to anything.
      </p>
      {err && <div className="s-error" role="alert">{err}</div>}
      {form.map((q) => (
        <label key={q.key} className="s-field">
          <span>{q.label}{q.required ? ' *' : ''}</span>
          {q.type === 'textarea' ? <textarea className="s-textarea" required={q.required} maxLength={2000} value={answers[q.key] || ''} onChange={(e) => set(q.key, e.target.value)} />
            : q.type === 'select' ? (
              <select className="s-select" required={q.required} value={answers[q.key] || ''} onChange={(e) => set(q.key, e.target.value)}>
                <option value="">Choose…</option>{(q.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
              </select>)
            : q.type === 'yesno' ? (
              <select className="s-select" required={q.required} value={answers[q.key] || ''} onChange={(e) => set(q.key, e.target.value)}>
                <option value="">Choose…</option><option value="yes">Yes</option><option value="no">No</option>
              </select>)
            : <input className="s-input" required={q.required} type={q.type === 'number' ? 'number' : q.type === 'date' ? 'date' : 'text'} min={q.type === 'number' ? 0 : undefined}
                inputMode={q.type === 'number' ? 'numeric' : undefined} maxLength={300} value={answers[q.key] || ''} onChange={(e) => set(q.key, e.target.value)} />}
        </label>
      ))}
      {!form.length && <p className="s-hint" style={{ marginBottom: 14 }}>{companyName} hasn't added questions — just submit and an agent will be in touch.</p>}
      <button className="s-btn s-btn-primary s-btn-block" disabled={busy}>{busy ? 'Submitting…' : 'Submit application'}</button>
    </form>
  );
}
