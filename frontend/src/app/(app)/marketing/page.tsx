'use client';
import { useEffect, useState } from 'react';
import { api, authStore } from '@/lib/api';
import { ScreenHead, Modal, fmtGHS } from '@/components/Shell';
import { I } from '@/components/Icons';

const AVAIL: Record<string, string> = {
  available: 'Available', reserved: 'Reserved', under_offer: 'Under offer', unavailable: 'Temporarily unavailable', rented: 'Rented', sold: 'Sold',
};
const PTYPES = ['apartment', 'house', 'townhouse', 'duplex', 'compound_house', 'chamber_and_hall', 'single_room', 'self_contained', 'land', 'commercial', 'office', 'warehouse'];
const AMENITIES = ['backup_power', 'borehole', 'security', 'gated', 'parking', 'pool', 'gym', 'air_conditioning', 'boys_quarters', 'garden', 'balcony', 'fitted_kitchen', 'wardrobes', 'cctv', 'elevator', 'water_storage', 'internet', 'prepaid_meter'];
const label = (k: string) => k.replace(/_/g, ' ');

/** Create / edit a listing with the fields the public website uses. */
function ListingEditor({ initial, onClose, onSaved }: { initial: any; onClose: () => void; onSaved: () => void }) {
  const isNew = !initial.id;
  const [f, setF] = useState<any>({
    title: '', location: '', neighbourhood: '', city: '', region: '', price: '', ptype: 'sale', property_type: '', bedrooms: '', bathrooms: '',
    size_sqm: '', furnishing: '', rent_period: 'month', advance_months: '', public_fees: '', description: '', amenities: [], featured: false,
    show_exact_location: false, lat: '', lng: '', ...initial,
    images: (initial.images || []).join('\n'),
  });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }));

  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr('');
    const keys = ['title', 'location', 'neighbourhood', 'city', 'region', 'price', 'ptype', 'property_type', 'bedrooms', 'bathrooms', 'size_sqm', 'furnishing', 'rent_period', 'advance_months', 'public_fees', 'description', 'amenities', 'featured', 'show_exact_location', 'lat', 'lng'];
    const body: any = Object.fromEntries(keys.map((k) => [k, f[k]]));
    if (body.ptype !== 'rent') { body.rent_period = null; body.advance_months = null; }
    body.images = String(f.images || '').split(/\s+/).map((u: string) => u.trim()).filter(Boolean);
    try {
      if (isNew) await api.marketing.addListing(body); else await api.marketing.updateListing(initial.id, body);
      onSaved();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  const inp = (k: string, l: string, props: any = {}) => {
    const { flex, minWidth, ...rest } = props;
    return (
      <div className="form-group" style={{ flex: flex || 1, minWidth: minWidth || 120 }}><label className="form-label">{l}</label>
        <input className="form-input" value={f[k] ?? ''} onChange={(e) => set(k, e.target.value)} {...rest} /></div>
    );
  };

  return (
    <Modal title={isNew ? 'New listing' : `Edit — ${initial.title}`} onClose={onClose}>
      <form onSubmit={save}>
        {!isNew && initial.listing_status === 'published' && <div className="muted" style={{ marginBottom: 10 }}>This listing is live — changes appear on your website as soon as you save.</div>}
        {inp('title', 'Title *', { required: true, maxLength: 160 })}
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <div className="form-group" style={{ flex: 1, minWidth: 120 }}><label className="form-label">For</label>
            <select className="form-select" value={f.ptype} onChange={(e) => set('ptype', e.target.value)}>
              <option value="sale">Sale</option><option value="rent">Rent</option><option value="land">Land</option><option value="development">Development</option>
            </select></div>
          <div className="form-group" style={{ flex: 1, minWidth: 140 }}><label className="form-label">Property type</label>
            <select className="form-select" value={f.property_type || ''} onChange={(e) => set('property_type', e.target.value || null)}>
              <option value="">—</option>{PTYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}
            </select></div>
        </div>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          {inp('price', 'Price (GHS) *', { type: 'number', required: true, min: 0 })}
          {f.ptype === 'rent' && (
            <div className="form-group" style={{ flex: 1, minWidth: 110 }}><label className="form-label">Per</label>
              <select className="form-select" value={f.rent_period || 'month'} onChange={(e) => set('rent_period', e.target.value)}><option value="month">month</option><option value="year">year</option></select></div>
          )}
          {f.ptype === 'rent' && inp('advance_months', 'Advance (months)', { type: 'number', min: 0, max: 60 })}
        </div>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          {inp('neighbourhood', 'Neighbourhood', { placeholder: 'East Legon' })}
          {inp('city', 'City / town', { placeholder: 'Accra' })}
          {inp('region', 'Region', { placeholder: 'Greater Accra' })}
        </div>
        {inp('location', 'Address / landmark (public)')}
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          {inp('bedrooms', 'Bedrooms', { type: 'number', min: 0, max: 50 })}
          {inp('bathrooms', 'Bathrooms', { type: 'number', min: 0, max: 50 })}
          {inp('size_sqm', 'Size (m²)', { type: 'number', min: 0 })}
          <div className="form-group" style={{ flex: 1, minWidth: 140 }}><label className="form-label">Furnishing</label>
            <select className="form-select" value={f.furnishing || ''} onChange={(e) => set('furnishing', e.target.value || null)}>
              <option value="">Not stated</option><option value="furnished">Furnished</option><option value="semi_furnished">Semi-furnished</option><option value="unfurnished">Unfurnished</option>
            </select></div>
        </div>
        <div className="form-group"><label className="form-label">Amenities (only tick what is confirmed)</label>
          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            {AMENITIES.map((a) => {
              const on = (f.amenities || []).includes(a);
              return <button type="button" key={a} className={`btn btn-sm${on ? ' btn-green' : ''}`} onClick={() => set('amenities', on ? f.amenities.filter((x: string) => x !== a) : [...(f.amenities || []), a])}>{label(a)}</button>;
            })}
          </div></div>
        <div className="form-group"><label className="form-label">Description</label>
          <textarea className="form-input" rows={4} value={f.description || ''} onChange={(e) => set('description', e.target.value)} /></div>
        {inp('public_fees', 'Fees to show publicly (agency, legal, service charge…)')}
        <div className="form-group"><label className="form-label">Photo links — one https:// URL per line</label>
          <textarea className="form-input" rows={3} value={f.images} onChange={(e) => set('images', e.target.value)} placeholder="https://…/front.jpg" /></div>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          {inp('lat', 'Latitude', { type: 'number', step: 'any' })}
          {inp('lng', 'Longitude', { type: 'number', step: 'any' })}
        </div>
        <label className="row" style={{ gap: 6, fontSize: 12, marginBottom: 6 }}><input type="checkbox" checked={!!f.show_exact_location} onChange={(e) => set('show_exact_location', e.target.checked)} /> Show exact map location publicly</label>
        <label className="row" style={{ gap: 6, fontSize: 12, marginBottom: 12 }}><input type="checkbox" checked={!!f.featured} onChange={(e) => set('featured', e.target.checked)} /> Feature on the website homepage</label>
        {err && <div style={{ color: 'var(--red)', fontSize: 12, marginBottom: 10 }}>{err}</div>}
        <button className="btn btn-green btn-block" disabled={busy}>{busy ? 'Saving…' : isNew ? 'Create draft listing' : 'Save changes'}</button>
      </form>
    </Modal>
  );
}

const LSTATUS: Record<string, [string, string]> = {
  draft: ['t-gray', 'Draft'], pending_approval: ['t-amber', 'Awaiting approval'],
  published: ['t-green', 'Published'], rejected: ['t-red', 'Rejected'],
};

export default function Marketing() {
  const user = typeof window !== 'undefined' ? authStore.getUser() : null;
  const isManager = ['owner', 'admin'].includes(user?.role);
  const canEdit = ['owner', 'admin', 'marketing'].includes(user?.role);

  const [attr, setAttr] = useState<any>(null);
  const [listings, setListings] = useState<any[]>([]);
  const [copyFor, setCopyFor] = useState<any>(null);
  const [copyText, setCopyText] = useState('');
  const [genBusy, setGenBusy] = useState(false);
  const [showCampaign, setShowCampaign] = useState(false);
  const [showBroadcast, setShowBroadcast] = useState(false);
  const [campaign, setCampaign] = useState({ platform: 'TikTok', name: '', spend: '' });
  const [editing, setEditing] = useState<any>(null);   // null = closed, {} = new, {...} = existing
  const [slug, setSlug] = useState<string>('');
  const [err, setErr] = useState('');
  const [bc, setBc] = useState({ channel: 'whatsapp', stage: 'all', message: '' });
  const [bcResult, setBcResult] = useState<number | null>(null);

  const load = () => {
    api.marketing.attribution().then(setAttr).catch(() => {});
    api.marketing.listings().then(setListings).catch(() => {});
  };
  useEffect(() => { load(); setSlug(authStore.getUser()?.company?.slug || ''); }, []);
  const run = async (fn: () => Promise<any>) => { setErr(''); try { await fn(); load(); } catch (e: any) { setErr(e.message); } };

  const generate = async (prop: any) => {
    setCopyFor(prop); setCopyText(''); setGenBusy(true);
    try { const r = await api.marketing.genCopy(prop.id); setCopyText(r.copy); } finally { setGenBusy(false); }
  };

  return (
    <div>
      <ScreenHead id="1e" title="Marketing" phase={2}>
        {canEdit && <button className="btn" onClick={() => setShowBroadcast(true)}><I name="megaphone" size={13} /> Broadcast</button>}
        {canEdit && <button className="btn" onClick={() => setShowCampaign(true)}>+ Campaign</button>}
        {canEdit && <button className="btn btn-green" onClick={() => setEditing({})}>+ Listing</button>}
      </ScreenHead>

      {/* Attribution table — was the TikTok ad worth it? */}
      <div className="section-title">Attribution — spend vs results per platform</div>
      <div className="card table-wrap" style={{ padding: 0, marginBottom: 20 }}>
        <table className="table">
          <thead><tr><th>Platform</th><th>Spend</th><th>Leads</th><th>Deals closed</th><th>Revenue</th><th>Cost / lead</th></tr></thead>
          <tbody>
            {(attr?.rows || []).map((r: any) => (
              <tr key={r.platform}>
                <td style={{ fontWeight: 600 }}>{r.platform}</td>
                <td>{r.spend ? fmtGHS(r.spend) : '—'}</td>
                <td>{r.leads}</td>
                <td>{r.dealsClosed}</td>
                <td style={{ color: r.revenue ? 'var(--green-bright)' : undefined, fontWeight: r.revenue ? 700 : 400 }}>{r.revenue ? fmtGHS(r.revenue) : '—'}</td>
                <td>{r.spend && r.leads ? fmtGHS(r.spend / r.leads) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Listings with AI copy + approval flow */}
      <div className="section-title">Listings — AI writes, you approve, then it publishes on your website</div>
      {err && <div className="card" style={{ borderColor: 'var(--red)', color: 'var(--red)', marginBottom: 10 }}>{err}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
        {listings.map((p) => {
          const [cls, label] = LSTATUS[p.listing_status] || ['t-gray', p.listing_status];
          return (
            <div key={p.id} className="card">
              <div className="spread" style={{ marginBottom: 6 }}>
                <div style={{ fontWeight: 700, fontSize: 13.5 }}>{p.title}</div>
                <span className={`tag ${cls}`}>{label}</span>
              </div>
              <div className="muted row" style={{ marginBottom: 6, gap: 4 }}><I name="pin" size={11} /> {p.neighbourhood || p.location || '—'} · {fmtGHS(p.price)}{p.ptype === 'rent' ? `/${p.rent_period === 'year' ? 'yr' : 'mo'}` : ''}{p.bedrooms != null ? ` · ${p.bedrooms} bed` : ''}</div>
              <div className="row" style={{ gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
                <select className="form-select" style={{ width: 'auto', minHeight: 28, padding: '2px 8px', fontSize: 12 }} value={p.availability || 'available'} disabled={!canEdit}
                  onChange={(e) => run(() => api.marketing.updateListing(p.id, { availability: e.target.value }))}>
                  {Object.entries(AVAIL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
                {canEdit && <button className="btn btn-sm" title="Record that availability was checked today" onClick={() => run(() => api.marketing.updateListing(p.id, { confirm_availability: true }))}>Still accurate</button>}
                <span className="muted" style={{ fontSize: 11 }}>{p.availability_confirmed_at ? `checked ${new Date(p.availability_confirmed_at).toLocaleDateString('en-GB')}` : 'never checked'}</span>
              </div>
              {p.description && <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 10 }}>{p.description.slice(0, 140)}{p.description.length > 140 ? '…' : ''}</div>}
              {p.lat && p.lng && (
                <a className="muted" style={{ display: 'block', marginBottom: 10, color: 'var(--blue)' }} target="_blank"
                  href={`https://www.google.com/maps?q=${p.lat},${p.lng}`}><I name="pin" size={11} style={{ verticalAlign: '-1px', marginRight: 3 }} />View on Google Maps</a>
              )}
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                {canEdit && <button className="btn btn-sm" onClick={() => setEditing(p)}><I name="edit" size={12} /> Edit</button>}
                {canEdit && <button className="btn btn-sm" onClick={() => generate(p)}><I name="sparkle" size={12} /> AI copy</button>}
                {canEdit && ['draft', 'rejected'].includes(p.listing_status) && <button className="btn btn-sm" onClick={() => run(() => api.marketing.submitListing(p.id))}>Submit for approval</button>}
                {p.listing_status === 'published' && slug && <a className="btn btn-sm" href={`/s/${slug}/property/${p.id}`} target="_blank" rel="noreferrer"><I name="globe" size={12} /> View on site</a>}
                {isManager && p.listing_status === 'published' && <button className="btn btn-sm" onClick={() => run(() => api.marketing.unpublishListing(p.id))}>Unpublish</button>}
                {isManager && <button className="btn btn-sm btn-red" onClick={() => { if (confirm('Archive this listing? It disappears from the website and this board.')) run(() => api.marketing.archiveListing(p.id)); }}>Archive</button>}
                {isManager && p.listing_status === 'pending_approval' && (
                  <>
                    <button className="btn btn-sm btn-green" onClick={async () => { await api.marketing.approveListing(p.id); load(); }}><I name="check" size={12} /> Approve & publish</button>
                    <button className="btn btn-sm btn-red" onClick={async () => { await api.marketing.rejectListing(p.id); load(); }}>Reject</button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* AI copy modal: Use it / Regenerate */}
      {copyFor && (
        <Modal title={`AI listing copy — ${copyFor.title}`} onClose={() => setCopyFor(null)}>
          {genBusy ? (
            <div className="muted" style={{ padding: 20, textAlign: 'center' }}>Writing…</div>
          ) : (
            <>
              <textarea className="form-input" rows={6} value={copyText} onChange={(e) => setCopyText(e.target.value)} />
              <div className="row" style={{ gap: 8, marginTop: 12 }}>
                <button className="btn btn-green" style={{ flex: 1 }} onClick={async () => {
                  await api.marketing.useCopy(copyFor.id, copyText);
                  setCopyFor(null); load();
                }}>Use it → submit for approval</button>
                <button className="btn" onClick={() => generate(copyFor)}><I name="refresh" size={13} /> Regenerate</button>
              </div>
            </>
          )}
        </Modal>
      )}

      {showCampaign && (
        <Modal title="New campaign" onClose={() => setShowCampaign(false)}>
          <form onSubmit={async (e) => {
            e.preventDefault();
            await api.marketing.addCampaign({ ...campaign, spend: Number(campaign.spend) || 0 });
            setShowCampaign(false); setCampaign({ platform: 'TikTok', name: '', spend: '' }); load();
          }}>
            <div className="form-group">
              <label className="form-label">Platform</label>
              <select className="form-select" value={campaign.platform} onChange={(e) => setCampaign((p) => ({ ...p, platform: e.target.value }))}>
                {['TikTok', 'Instagram', 'X', 'Facebook', 'Website'].map((p) => <option key={p}>{p}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Name *</label>
              <input className="form-input" required value={campaign.name} onChange={(e) => setCampaign((p) => ({ ...p, name: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label">Spend (GHS)</label>
              <input className="form-input" type="number" value={campaign.spend} onChange={(e) => setCampaign((p) => ({ ...p, spend: e.target.value }))} />
            </div>
            <button className="btn btn-green btn-block">Add campaign</button>
          </form>
        </Modal>
      )}

      {editing && <ListingEditor initial={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}

      {showBroadcast && (
        <Modal title="Bulk campaign message" onClose={() => { setShowBroadcast(false); setBcResult(null); }}>
          {bcResult !== null ? (
            <div style={{ textAlign: 'center', padding: 16 }}>
              <div style={{ marginBottom: 8 }}><I name="check" size={30} style={{ color: 'var(--green)' }} /></div>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>Sent to {bcResult} lead{bcResult === 1 ? '' : 's'}</div>
              <div className="muted">Check the Outbox in Audit Log to inspect each message.</div>
            </div>
          ) : (
            <form onSubmit={async (e) => {
              e.preventDefault();
              const r = await api.marketing.broadcast(bc);
              setBcResult(r.sent);
            }}>
              <div className="row" style={{ gap: 10 }}>
                <div className="form-group" style={{ flex: 1 }}><label className="form-label">Channel</label>
                  <select className="form-select" value={bc.channel} onChange={(e) => setBc((p) => ({ ...p, channel: e.target.value }))}>
                    {['whatsapp', 'sms', 'email'].map((c) => <option key={c}>{c}</option>)}
                  </select></div>
                <div className="form-group" style={{ flex: 1 }}><label className="form-label">Audience</label>
                  <select className="form-select" value={bc.stage} onChange={(e) => setBc((p) => ({ ...p, stage: e.target.value }))}>
                    <option value="all">All leads</option>
                    {['new', 'contacted', 'viewing', 'closing'].map((s) => <option key={s} value={s}>{s} stage</option>)}
                  </select></div>
              </div>
              <div className="form-group">
                <label className="form-label">Message * <span className="muted">({'{name}'} personalises)</span></label>
                <textarea className="form-input" required rows={4} value={bc.message} onChange={(e) => setBc((p) => ({ ...p, message: e.target.value }))}
                  placeholder="Hi {name}! New units just released at East Legon Hills…" />
              </div>
              <button className="btn btn-green btn-block">Send broadcast</button>
            </form>
          )}
        </Modal>
      )}
    </div>
  );
}
