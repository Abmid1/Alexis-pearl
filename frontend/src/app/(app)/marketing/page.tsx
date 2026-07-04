'use client';
import { useEffect, useState } from 'react';
import { api, authStore } from '@/lib/api';
import { ScreenHead, Modal, fmtGHS } from '@/components/Shell';

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
  const [showListing, setShowListing] = useState(false);
  const [showBroadcast, setShowBroadcast] = useState(false);
  const [campaign, setCampaign] = useState({ platform: 'TikTok', name: '', spend: '' });
  const [listing, setListing] = useState({ title: '', location: '', price: '', ptype: 'sale', description: '' });
  const [bc, setBc] = useState({ channel: 'whatsapp', stage: 'all', message: '' });
  const [bcResult, setBcResult] = useState<number | null>(null);

  const load = () => {
    api.marketing.attribution().then(setAttr).catch(() => {});
    api.marketing.listings().then(setListings).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const generate = async (prop: any) => {
    setCopyFor(prop); setCopyText(''); setGenBusy(true);
    try { const r = await api.marketing.genCopy(prop.id); setCopyText(r.copy); } finally { setGenBusy(false); }
  };

  return (
    <div>
      <ScreenHead id="1e" title="Marketing" phase={2}>
        {canEdit && <button className="btn" onClick={() => setShowBroadcast(true)}>📢 Broadcast</button>}
        {canEdit && <button className="btn" onClick={() => setShowCampaign(true)}>+ Campaign</button>}
        {canEdit && <button className="btn btn-green" onClick={() => setShowListing(true)}>+ Listing</button>}
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
      <div className="section-title">Listings — AI writes, you approve, then it publishes</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
        {listings.map((p) => {
          const [cls, label] = LSTATUS[p.listing_status] || ['t-gray', p.listing_status];
          return (
            <div key={p.id} className="card">
              <div className="spread" style={{ marginBottom: 6 }}>
                <div style={{ fontWeight: 700, fontSize: 13.5 }}>{p.title}</div>
                <span className={`tag ${cls}`}>{label}</span>
              </div>
              <div className="muted" style={{ marginBottom: 6 }}>📍 {p.location} · {fmtGHS(p.price)}{p.ptype === 'rent' ? '/mo' : ''}</div>
              {p.description && <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 10 }}>{p.description.slice(0, 140)}{p.description.length > 140 ? '…' : ''}</div>}
              {p.lat && p.lng && (
                <a className="muted" style={{ display: 'block', marginBottom: 10, color: 'var(--blue)' }} target="_blank"
                  href={`https://www.google.com/maps?q=${p.lat},${p.lng}`}>🗺 View on Google Maps</a>
              )}
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                {canEdit && <button className="btn btn-sm" onClick={() => generate(p)}>🤖 AI copy</button>}
                {isManager && p.listing_status === 'pending_approval' && (
                  <>
                    <button className="btn btn-sm btn-green" onClick={async () => { await api.marketing.approveListing(p.id); load(); }}>✓ Approve & publish</button>
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
                <button className="btn" onClick={() => generate(copyFor)}>↻ Regenerate</button>
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

      {showListing && (
        <Modal title="New listing" onClose={() => setShowListing(false)}>
          <form onSubmit={async (e) => {
            e.preventDefault();
            await api.marketing.addListing({ ...listing, price: Number(listing.price) || 0 });
            setShowListing(false); setListing({ title: '', location: '', price: '', ptype: 'sale', description: '' }); load();
          }}>
            <div className="form-group"><label className="form-label">Title *</label>
              <input className="form-input" required value={listing.title} onChange={(e) => setListing((p) => ({ ...p, title: e.target.value }))} /></div>
            <div className="form-group"><label className="form-label">Location</label>
              <input className="form-input" value={listing.location} onChange={(e) => setListing((p) => ({ ...p, location: e.target.value }))} /></div>
            <div className="row" style={{ gap: 10 }}>
              <div className="form-group" style={{ flex: 1 }}><label className="form-label">Price (GHS) *</label>
                <input className="form-input" type="number" required value={listing.price} onChange={(e) => setListing((p) => ({ ...p, price: e.target.value }))} /></div>
              <div className="form-group" style={{ width: 130 }}><label className="form-label">Type</label>
                <select className="form-select" value={listing.ptype} onChange={(e) => setListing((p) => ({ ...p, ptype: e.target.value }))}>
                  {['sale', 'rent', 'land', 'development'].map((t) => <option key={t}>{t}</option>)}
                </select></div>
            </div>
            <div className="form-group"><label className="form-label">Notes for the AI copywriter</label>
              <textarea className="form-input" rows={2} value={listing.description} onChange={(e) => setListing((p) => ({ ...p, description: e.target.value }))} /></div>
            <button className="btn btn-green btn-block">Create draft listing</button>
          </form>
        </Modal>
      )}

      {showBroadcast && (
        <Modal title="Bulk campaign message" onClose={() => { setShowBroadcast(false); setBcResult(null); }}>
          {bcResult !== null ? (
            <div style={{ textAlign: 'center', padding: 16 }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>✅</div>
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
