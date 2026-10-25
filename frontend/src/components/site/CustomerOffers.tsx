'use client';
import { useEffect, useState } from 'react';
import { accountApi } from './session';

const when = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Accra' });
const money = (n: number, c = 'GHS') => `${c} ${Number(n || 0).toLocaleString('en-GH', { maximumFractionDigits: 0 })}`;

/** Offers the agency has put in writing. Responding records intent, not a contract. */
export default function CustomerOffers({ slug, companyName, onError }: { slug: string; companyName: string; onError: (t: string) => void }) {
  const [offers, setOffers] = useState<any[] | null>(null);
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState<{ id: string; accept: boolean } | null>(null);

  const load = () => accountApi(slug, '/offers').then((r) => setOffers(r.offers)).catch((e: any) => onError(e.message));
  useEffect(() => { load(); }, [slug]);
  if (!offers) return <p className="s-hint">Loading…</p>;
  if (!offers.length) return <div className="s-empty"><p>{companyName} hasn't sent you an offer yet. You'll see it here, and they'll message you.</p></div>;

  const respond = async (id: string, accept: boolean) => {
    setBusy(id);
    try { await accountApi(slug, `/offers/${id}/respond`, { method: 'POST', body: { accept, note } }); setConfirming(null); setNote(''); await load(); }
    catch (e: any) { onError(e.message); } finally { setBusy(''); }
  };

  return (
    <div className="s-timeline">
      {offers.map((o) => (
        <div key={o.id} className="s-status-card">
          <div className="s-hint">Ref {o.reference} · {when(o.created_at)}</div>
          <div style={{ fontWeight: 650, fontSize: 16 }}>{o.property?.title || 'Offer'}</div>
          <div style={{ fontSize: 26, fontWeight: 750, letterSpacing: '-0.02em' }}>{money(o.amount, o.currency)}</div>
          <div className="s-status"><span className={`s-dot ${o.status === 'accepted' ? '' : ['declined', 'withdrawn', 'expired'].includes(o.status) ? 'bad' : 'warn'}`} /> <b>{o.status_label}</b></div>
          <span className="s-hint" style={{ fontSize: 14.5 }}>{o.next_step}</span>
          {o.terms && <div className="s-note" style={{ whiteSpace: 'pre-line' }}><b>Terms</b>{'\n'}{o.terms}</div>}
          {o.expires_at && o.can_respond && <span className="s-hint">Please respond by {when(o.expires_at)}.</span>}
          <div className="s-note" style={{ fontSize: 13 }}>{o.disclaimer}</div>

          {o.can_respond && (confirming?.id === o.id ? (
            <div style={{ display: 'grid', gap: 10 }}>
              <b>{confirming.accept ? 'Accept this offer?' : 'Decline this offer?'}</b>
              <span className="s-hint">{confirming.accept
                ? 'This tells the agency you want to go ahead. It is not a contract and nothing is binding until you sign an agreement.'
                : 'The agency will be told you do not want to proceed.'}</span>
              <label className="s-field" style={{ margin: 0 }}><span>Add a note (optional)</span>
                <textarea className="s-textarea" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} /></label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="s-btn s-btn-primary" disabled={busy === o.id} onClick={() => respond(o.id, confirming.accept)}>
                  {busy === o.id ? 'Sending…' : confirming.accept ? 'Yes, accept' : 'Yes, decline'}
                </button>
                <button className="s-btn s-btn-quiet" onClick={() => setConfirming(null)}>Go back</button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="s-btn s-btn-primary s-btn-sm" onClick={() => { setConfirming({ id: o.id, accept: true }); setNote(''); }}>Accept</button>
              <button className="s-btn s-btn-ghost s-btn-sm" onClick={() => { setConfirming({ id: o.id, accept: false }); setNote(''); }}>Decline</button>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
