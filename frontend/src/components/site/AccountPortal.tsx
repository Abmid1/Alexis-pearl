'use client';
import { useCallback, useEffect, useState } from 'react';
import { PUBLIC_API } from '@/lib/publicApi';
import { I } from '@/components/Icons';
import PropertyCard from './PropertyCard';
import SignIn from './SignIn';
import CustomerDocuments from './CustomerDocuments';
import CustomerOffers from './CustomerOffers';
import CustomerProgress from './CustomerProgress';
import { accountApi, session } from './session';

const TZ = 'Africa/Accra';
const fmt = (iso: string) => new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: TZ });
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: TZ });
const tone = (s: string) => (['confirmed', 'completed', 'approved'].includes(s) ? '' : ['requested', 'submitted', 'under_review', 'info_requested', 'new', 'in_progress'].includes(s) ? 'warn' : 'bad');

type Tab = 'requests' | 'applications' | 'offers' | 'progress' | 'documents' | 'saved' | 'tenancy' | 'settings';

/** Signed-in customer's portal for one agency. */
export default function AccountPortal({ slug, companyName }: { slug: string; companyName: string }) {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [data, setData] = useState<any>(null);
  const [tab, setTab] = useState<Tab>('requests');
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    setErr('');
    try { setData(await accountApi(slug, '/overview')); setSignedIn(true); }
    catch (e: any) { if (e.status === 401) setSignedIn(false); else setErr(e.message); }
  }, [slug]);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab') as Tab | null;
    if (t && ['requests', 'applications', 'offers', 'progress', 'documents', 'saved', 'tenancy', 'settings'].includes(t)) setTab(t);
    if (!session.get(slug)) { setSignedIn(false); return; }
    load();
  }, [slug, load]);

  if (signedIn === null) return <p className="s-hint">Loading your account…</p>;
  if (!signedIn) return <SignIn slug={slug} companyName={companyName} onDone={load} />;
  if (!data) return <p className="s-hint">{err || 'Loading…'}</p>;

  const c = data.customer;
  const contact = c.verified_phone || c.verified_email;
  const cancel = async (ref: string, id: string) => {
    if (!confirm('Cancel this viewing?')) return;
    const r = await fetch(`${PUBLIC_API}/api/public/${slug}/requests/${ref}/viewings/${id}/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contact }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) setErr(j.error || 'Could not cancel'); else load();
  };
  const tabs: [Tab, string, number?][] = [
    ['requests', 'Requests & viewings', data.enquiries.length],
    ['applications', 'Applications', data.applications.length],
    ...(data.offers ? [['offers', 'Offers', data.offers_awaiting || undefined] as [Tab, string, number?]] : []),
    ...(data.transactions ? [['progress', 'Progress'] as [Tab, string]] : []),
    ['documents', 'Documents', data.document_requests || undefined],
    ['saved', 'Saved homes', data.saved.length],
    ...(data.has_tenancy ? [['tenancy', 'My tenancy'] as [Tab, string]] : []),
    ['settings', 'Settings'],
  ];

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div><h2 style={{ fontSize: 22 }}>Hello, {c.name.split(' ')[0]}</h2><p className="s-hint">Signed in with {contact}</p></div>
        <button className="s-btn s-btn-ghost s-btn-sm" onClick={() => { session.clear(slug); setSignedIn(false); setData(null); }}>Sign out</button>
      </div>

      <div className="s-days" role="tablist" aria-label="Account sections" style={{ marginBottom: 0 }}>
        {tabs.map(([k, l, n]) => (
          <button key={k} role="tab" aria-selected={tab === k} aria-pressed={tab === k} onClick={() => setTab(k)} style={{ minWidth: 'auto', padding: '10px 14px', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            {l}{n ? <small style={{ fontWeight: 600 }}>{n}</small> : null}
          </button>
        ))}
      </div>
      {err && <div className="s-error" role="alert">{err}</div>}
      {msg && <div className="s-success" role="status">{msg}</div>}

      {tab === 'requests' && (data.enquiries.length ? (
        <div className="s-timeline">
          {data.enquiries.map((e: any) => (
            <div key={e.reference} className="s-status-card">
              <div className="s-hint">Ref {e.reference} · {fmtDate(e.created_at)}</div>
              <div style={{ fontWeight: 650, fontSize: 17 }}>{e.kind === 'viewing' ? 'Viewing request' : 'Enquiry'}{e.property ? ` — ${e.property.title}` : ''}</div>
              <div className="s-status"><span className={`s-dot ${tone(e.status)}`} /> {e.status_label}</div>
              {e.viewings.map((v: any) => (
                <div key={v.id} className="s-note" style={{ display: 'grid', gap: 4 }}>
                  <div className="s-status"><span className={`s-dot ${tone(v.status)}`} /><b>{v.status_label}</b> · {fmt(v.starts_at)}</div>
                  <span>{v.next_step}</span>
                  {v.agent_name && <span>Your agent: <b>{v.agent_name}</b></span>}
                  {v.decline_reason && <span>Message: {v.decline_reason}</span>}
                  {v.can_change && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
                    <a className="s-btn s-btn-ghost s-btn-sm" href={`/s/${slug}/track?ref=${e.reference}`}>Change time</a>
                    <button className="s-btn s-btn-quiet" onClick={() => cancel(e.reference, v.id)}>Cancel</button>
                  </div>}
                </div>
              ))}
              <a className="s-btn s-btn-quiet" style={{ justifySelf: 'start' }} href={`/s/${slug}/track?ref=${e.reference}`}><I name="chat" size={16} /> Messages with the agency</a>
            </div>
          ))}
        </div>
      ) : <Empty slug={slug} text="You haven't sent any enquiries or viewing requests with this phone or email yet." />)}

      {tab === 'applications' && (data.applications.length ? (
        <div className="s-timeline">
          {data.applications.map((a: any) => (
            <a key={a.id} className="s-status-card" href={`/s/${slug}/account/applications/${a.id}`}>
              <div className="s-hint">Ref {a.reference} · {fmtDate(a.created_at)}</div>
              <div style={{ fontWeight: 650, fontSize: 17 }}>{a.kind === 'rental' ? 'Rental' : 'Purchase'} application{a.property ? ` — ${a.property.title}` : ''}</div>
              <div className="s-status"><span className={`s-dot ${tone(a.status)}`} /> <b>{a.status_label}</b></div>
              <span className="s-hint" style={{ fontSize: 14.5 }}>{a.next_step}</span>
              {a.status === 'info_requested' && <span className="s-badge s-badge-warn" style={{ justifySelf: 'start' }}>Action needed</span>}
            </a>
          ))}
        </div>
      ) : <Empty slug={slug} text="No applications yet. Open a listing and choose “Apply” when you're ready." />)}

      {tab === 'saved' && (data.saved.length
        ? <div className="s-grid">{data.saved.map((p: any) => <PropertyCard key={p.id} slug={slug} p={p} />)}</div>
        : <Empty slug={slug} text="Tap the heart on any listing to save it to your account." />)}

      {tab === 'offers' && <CustomerOffers slug={slug} companyName={companyName} onError={setErr} />}
      {tab === 'progress' && <CustomerProgress slug={slug} companyName={companyName} onError={setErr} />}
      {tab === 'documents' && <CustomerDocuments slug={slug} companyName={companyName} onError={setErr} />}

      {tab === 'tenancy' && <Tenancy slug={slug} companyName={companyName} onError={setErr} />}

      {tab === 'settings' && <Settings slug={slug} customer={c} onSaved={(t) => { setMsg(t); load(); setTimeout(() => setMsg(''), 3000); }} onError={setErr} />}
    </div>
  );
}

function Empty({ slug, text }: { slug: string; text: string }) {
  return (
    <div className="s-empty"><p>{text}</p><a className="s-btn s-btn-primary" href={`/s/${slug}/properties`}>Browse listings</a></div>
  );
}

function Tenancy({ slug, companyName, onError }: { slug: string; companyName: string; onError: (t: string) => void }) {
  const [t, setT] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: '', description: '' });
  const load = () => accountApi(slug, '/tenancy').then(setT).catch((e: any) => onError(e.message));
  useEffect(() => { load(); }, [slug]);
  if (!t) return <p className="s-hint">Loading your tenancy…</p>;

  const money = (n: number) => `GHS ${Number(n || 0).toLocaleString('en-GH', { maximumFractionDigits: 0 })}`;
  const date = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Accra' });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    try { await accountApi(slug, '/maintenance', { method: 'POST', body: form }); setForm({ title: '', description: '' }); setOpen(false); await load(); }
    catch (e: any) { onError(e.message); } finally { setBusy(false); }
  };

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      {t.leases.map((l: any) => (
        <div key={l.id} className="s-panel" style={{ display: 'grid', gap: 14 }}>
          <div className="spread" style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <div><div style={{ fontWeight: 650, fontSize: 18 }}>{l.property?.title || 'Your home'}</div>{l.unit && <div className="s-hint">{l.unit}</div>}</div>
            <span className={`s-badge ${l.in_arrears ? 's-badge-bad' : 's-badge-ok'}`}>{l.in_arrears ? 'Rent due' : 'Up to date'}</span>
          </div>
          <div className="s-specs" style={{ margin: 0 }}>
            <div><dt>Rent</dt><dd>{money(l.rent_amount)}<small style={{ fontWeight: 400 }}> / month</small></dd></div>
            <div><dt>Next payment</dt><dd>{l.next_due_date ? date(l.next_due_date) : '—'}</dd></div>
            <div><dt>Balance this month</dt><dd>{money(l.balance_this_month)}</dd></div>
            <div><dt>Tenancy ends</dt><dd>{l.end_date ? date(l.end_date) : '—'}</dd></div>
          </div>
          {l.renewal_due && <div className="s-note">Your tenancy ends in {l.days_to_end} days. {companyName} may contact you about renewing.</div>}
          {l.last_payment && <div className="s-hint">Last payment: {money(l.last_payment.amount)} by {l.last_payment.method} on {date(l.last_payment.date)}.</div>}
          <p className="s-hint" style={{ fontSize: 13 }}>Rent figures are based on payments {companyName} has recorded. Check with the agency if anything looks wrong.</p>
        </div>
      ))}

      <div className="s-panel">
        <div className="spread" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ fontSize: 18 }}>Maintenance</h2>
          <button className="s-btn s-btn-primary s-btn-sm" onClick={() => setOpen((v) => !v)}><I name="tool" size={16} /> Report a problem</button>
        </div>
        {open && (
          <form onSubmit={submit} style={{ display: 'grid', gap: 10, marginBottom: 16 }}>
            <label className="s-field" style={{ margin: 0 }}><span>What's wrong?</span><input className="s-input" required minLength={3} maxLength={200} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Leaking kitchen tap" /></label>
            <label className="s-field" style={{ margin: 0 }}><span>Details</span><textarea className="s-textarea" required minLength={5} maxLength={2000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="When did it start? Where exactly?" /></label>
            <button className="s-btn s-btn-primary" disabled={busy} style={{ justifySelf: 'start' }}>{busy ? 'Sending…' : 'Send request'}</button>
          </form>
        )}
        {t.maintenance.length ? (
          <div className="s-timeline">
            {t.maintenance.map((m: any) => (
              <div key={m.id} className="s-note" style={{ display: 'grid', gap: 4 }}>
                <div className="spread" style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><b>{m.title}</b><span className="s-hint">{date(m.created_at)}</span></div>
                {m.description && <span>{m.description}</span>}
                <div className="s-status"><span className={`s-dot ${m.status === 'resolved' ? '' : 'warn'}`} /> {m.status_label} — {m.next_step}</div>
              </div>
            ))}
          </div>
        ) : <p className="s-hint">No maintenance requests yet.</p>}
      </div>

      {t.payments.length > 0 && (
        <div className="s-panel">
          <h2 style={{ fontSize: 18, marginBottom: 12 }}>Payment history</h2>
          <div className="s-contact-list">
            {t.payments.map((p: any) => (
              <div key={p.id} style={{ justifyContent: 'space-between' }}><span>{date(p.date)} · {p.method}</span><b>{money(p.amount)}</b></div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Settings({ slug, customer, onSaved, onError }: { slug: string; customer: any; onSaved: (t: string) => void; onError: (t: string) => void }) {
  const [name, setName] = useState(customer.name);
  const [prefs, setPrefs] = useState(customer.notification_prefs);
  const [busy, setBusy] = useState(false);
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    try { await accountApi(slug, '/me', { method: 'PATCH', body: { name, notification_prefs: prefs } }); onSaved('Settings saved.'); }
    catch (e: any) { onError(e.message); } finally { setBusy(false); }
  };
  return (
    <form className="s-panel" onSubmit={save} style={{ maxWidth: 520 }}>
      <label className="s-field"><span>Your name</span><input className="s-input" value={name} onChange={(e) => setName(e.target.value)} minLength={2} maxLength={80} required /></label>
      <div className="s-field"><span>Contact details</span>
        <p className="s-hint" style={{ fontSize: 15 }}>
          {customer.verified_phone && <>Phone: {customer.verified_phone} (verified)<br /></>}
          {customer.verified_email && <>Email: {customer.verified_email} (verified)<br /></>}
          To add or change a phone or email, sign in with it — it's verified with a code.
        </p></div>
      <fieldset style={{ border: 0, padding: 0, marginBottom: 14 }}>
        <legend className="s-label" style={{ marginBottom: 8 }}>Send me updates about my requests by</legend>
        <label className="s-check"><input type="checkbox" checked={!!prefs.whatsapp} onChange={(e) => setPrefs({ ...prefs, whatsapp: e.target.checked })} /> <span>WhatsApp</span></label>
        <label className="s-check"><input type="checkbox" checked={!!prefs.email} onChange={(e) => setPrefs({ ...prefs, email: e.target.checked })} /> <span>Email</span></label>
      </fieldset>
      <button className="s-btn s-btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save settings'}</button>
    </form>
  );
}
