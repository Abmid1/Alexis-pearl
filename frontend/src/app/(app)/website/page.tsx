'use client';
import { useEffect, useState } from 'react';
import { api, authStore } from '@/lib/api';
import { ScreenHead } from '@/components/Shell';
import { I } from '@/components/Icons';

const SERVICES = [['buy', 'Homes for sale'], ['rent', 'Rentals'], ['land', 'Land'], ['sell', 'Sell with us'], ['management', 'Property management'], ['valuation', 'Valuations']];
const SOCIALS = ['instagram', 'facebook', 'tiktok', 'x', 'linkedin', 'youtube', 'website'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function Website() {
  const user = typeof window !== 'undefined' ? authStore.getUser() : null;
  const isManager = ['owner', 'admin'].includes(user?.role);
  const [c, setC] = useState<any>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [origin, setOrigin] = useState('');

  useEffect(() => { setOrigin(window.location.origin); api.company.get().then(setC).catch((e) => setMsg({ ok: false, text: e.message })); }, []);
  if (!c) return <div className="muted">{msg?.text || 'Loading…'}</div>;

  const set = (k: string, v: any) => setC((p: any) => ({ ...p, [k]: v }));
  const hours = c.viewing_hours || { days: [1, 2, 3, 4, 5, 6], start: '09:00', end: '16:00', slot_minutes: 45, min_notice_hours: 24, max_days_ahead: 21, cancel_cutoff_hours: 2 };
  const setH = (k: string, v: any) => set('viewing_hours', { ...hours, [k]: v });
  const link = `${origin}/s/${c.slug}`;

  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setMsg(null);
    try {
      const { id, custom_domain, ...body } = c;
      if (user?.role !== 'owner') delete body.slug;
      setC(await api.company.update(body));
      setMsg({ ok: true, text: 'Saved — your website is updated.' });
    } catch (e: any) { setMsg({ ok: false, text: e.message }); } finally { setBusy(false); }
  };

  const field = (k: string, label: string, props: any = {}) => (
    <div className="form-group"><label className="form-label">{label}</label>
      <input className="form-input" value={c[k] || ''} onChange={(e) => set(k, e.target.value)} disabled={!isManager} {...props} /></div>
  );

  return (
    <form onSubmit={save}>
      <ScreenHead id="" title="Customer website">
        <a className="btn" href={`/s/${c.slug}`} target="_blank" rel="noreferrer"><I name="globe" size={13} /> Open website</a>
        {isManager && <button className="btn btn-green" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>}
      </ScreenHead>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="spread" style={{ flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0 }}>
            <div className="form-label">Your shareable link</div>
            <div style={{ fontFamily: 'monospace', fontSize: 13, wordBreak: 'break-all' }}>{link}</div>
            <div className="muted" style={{ marginTop: 4 }}>Share it on WhatsApp, Instagram or your business card. Only published listings appear there.</div>
          </div>
          <button type="button" className="btn btn-sm" onClick={() => navigator.clipboard?.writeText(link).then(() => setMsg({ ok: true, text: 'Link copied' }))}>Copy link</button>
        </div>
        <label className="row" style={{ gap: 8, marginTop: 12, fontSize: 13 }}>
          <input type="checkbox" checked={!!c.public_enabled} disabled={!isManager} onChange={(e) => set('public_enabled', e.target.checked)} />
          Website is live {c.public_enabled ? '' : <span className="tag t-red">offline — customers see “not found”</span>}
        </label>
      </div>

      {msg && <div className="card" style={{ marginBottom: 12, borderColor: msg.ok ? 'var(--green)' : 'var(--red)', color: msg.ok ? 'var(--green)' : 'var(--red)' }}>{msg.text}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
        <div className="card">
          <div className="section-title" style={{ marginTop: 0 }}>Brand</div>
          {field('name', 'Company name *', { required: true })}
          {field('tagline', 'Tagline', { placeholder: 'Homes and land across Greater Accra' })}
          <div className="form-group"><label className="form-label">About</label>
            <textarea className="form-input" rows={4} value={c.about || ''} disabled={!isManager} onChange={(e) => set('about', e.target.value)} /></div>
          {field('logo_url', 'Logo URL (https://…)', { type: 'url', placeholder: 'https://…/logo.png' })}
          <div className="form-group"><label className="form-label">Brand colour</label>
            <div className="row">
              <input type="color" value={c.brand_color || '#4038B8'} disabled={!isManager} onChange={(e) => set('brand_color', e.target.value.toUpperCase())} style={{ width: 44, height: 36, border: 'none', background: 'none' }} />
              <input className="form-input" value={c.brand_color || ''} disabled={!isManager} onChange={(e) => set('brand_color', e.target.value)} style={{ maxWidth: 130 }} />
            </div></div>
          {user?.role === 'owner' && field('slug', 'Website address (changing it breaks old links)', { pattern: '[a-z0-9][a-z0-9-]{1,38}[a-z0-9]' })}
        </div>

        <div className="card">
          <div className="section-title" style={{ marginTop: 0 }}>Contact</div>
          {field('contact_phone', 'Phone')}
          {field('whatsapp', 'WhatsApp number')}
          {field('contact_email', 'Email', { type: 'email' })}
          {field('address', 'Office address')}
          {field('office_hours', 'Office hours', { placeholder: 'Mon–Sat, 8:30am–5pm' })}
          <div className="section-title">Social links</div>
          {SOCIALS.map((s) => (
            <div className="form-group" key={s}><label className="form-label" style={{ textTransform: 'capitalize' }}>{s}</label>
              <input className="form-input" type="url" placeholder="https://" disabled={!isManager} value={c.socials?.[s] || ''} onChange={(e) => set('socials', { ...(c.socials || {}), [s]: e.target.value })} /></div>
          ))}
        </div>

        <div className="card">
          <div className="section-title" style={{ marginTop: 0 }}>Services shown to customers</div>
          {SERVICES.map(([k, label]) => (
            <label key={k} className="row" style={{ gap: 8, marginBottom: 8, fontSize: 13 }}>
              <input type="checkbox" disabled={!isManager} checked={(c.services || []).includes(k)}
                onChange={(e) => set('services', e.target.checked ? [...(c.services || []), k] : (c.services || []).filter((x: string) => x !== k))} />
              {label}
            </label>
          ))}

          <div className="section-title">Viewing schedule</div>
          <div className="muted" style={{ marginBottom: 8 }}>Customers pick from these slots. A request is never booked until your team confirms it.</div>
          <div className="row" style={{ gap: 4, flexWrap: 'wrap', marginBottom: 10 }}>
            {DAYS.map((d, i) => (
              <button type="button" key={d} disabled={!isManager} className={`btn btn-sm${hours.days.includes(i) ? ' btn-green' : ''}`}
                onClick={() => setH('days', hours.days.includes(i) ? hours.days.filter((x: number) => x !== i) : [...hours.days, i])}>{d}</button>
            ))}
          </div>
          <div className="row" style={{ gap: 10 }}>
            <div className="form-group" style={{ flex: 1 }}><label className="form-label">From</label><input className="form-input" type="time" value={hours.start} disabled={!isManager} onChange={(e) => setH('start', e.target.value)} /></div>
            <div className="form-group" style={{ flex: 1 }}><label className="form-label">To</label><input className="form-input" type="time" value={hours.end} disabled={!isManager} onChange={(e) => setH('end', e.target.value)} /></div>
          </div>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            {[['slot_minutes', 'Slot (min)'], ['min_notice_hours', 'Notice (hours)'], ['max_days_ahead', 'Days ahead'], ['cancel_cutoff_hours', 'Customer can cancel until (hours before)']].map(([k, l]) => (
              <div className="form-group" style={{ flex: '1 1 120px' }} key={k}><label className="form-label">{l}</label>
                <input className="form-input" type="number" min={0} value={hours[k]} disabled={!isManager} onChange={(e) => setH(k, Number(e.target.value))} /></div>
            ))}
          </div>
          <div className="muted">Times are Ghana time (GMT).</div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="section-title" style={{ marginTop: 0 }}>What customers can see</div>
        <ul style={{ paddingLeft: 18, lineHeight: 1.9, fontSize: 13, color: 'var(--text-secondary)' }}>
          <li>Only listings an owner or admin has <b>approved & published</b> (Marketing → Listings). Unpublish or archive to remove one instantly.</li>
          <li>Sold, rented and temporarily unavailable listings show an honest status and accept no new viewing requests.</li>
          <li>Never visible: internal notes, lead stages, commissions, client documents, other customers.</li>
          <li>The website assistant answers only from published listings and knowledge-base documents you mark <b>On website</b>.</li>
          <li>Enquiries create or update a lead (matched by phone/email, never by name) and land in your Inbox with an AI draft for review.</li>
        </ul>
      </div>
    </form>
  );
}
