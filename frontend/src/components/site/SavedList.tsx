'use client';
import { useEffect, useState } from 'react';
import { PUBLIC_API, PublicProperty, fmtPrice, label, placeLine, propertyPath } from '@/lib/publicApi';
import PropertyCard from './PropertyCard';
import { saved } from './store';
import { accountApi, session } from './session';

/** Saved listings (this device) with a side-by-side comparison of up to 4. */
export default function SavedList({ slug }: { slug: string }) {
  const [items, setItems] = useState<PublicProperty[] | null>(null);
  const [gone, setGone] = useState(0);

  useEffect(() => {
    const load = async () => {
      const ids = saved.list(slug);
      const res = await Promise.all(ids.map((id) =>
        fetch(`${PUBLIC_API}/api/public/${slug}/properties/${id}`).then((r) => (r.ok ? r.json() : null)).catch(() => null)));
      let list: PublicProperty[] = res.filter(Boolean).map((r: any) => r.property);
      // signed in: include homes saved from the customer's other devices
      if (session.get(slug)) {
        const acc = await accountApi(slug, '/saved').catch(() => null);
        if (acc?.items) {
          list = [...list, ...acc.items.filter((p: PublicProperty) => !list.some((x) => x.id === p.id))];
          saved.merge(slug, acc.items.map((p: PublicProperty) => p.id));   // hearts show as saved here too
        }
      }
      setItems(list);
      setGone(res.filter((r) => !r).length);
    };
    load();
    window.addEventListener('bilt:saved', load);
    return () => window.removeEventListener('bilt:saved', load);
  }, [slug]);

  if (!items) return <p className="s-hint">Loading your saved homes…</p>;
  if (!items.length) {
    return (
      <div className="s-empty">
        <h2>No saved homes yet</h2>
        <p>Tap the heart on any listing to keep it here. Saved homes stay on this device — no account needed.</p>
        <a className="s-btn s-btn-primary" href={`/s/${slug}/properties`}>Browse listings</a>
      </div>
    );
  }
  const cmp = items.slice(0, 4);
  const rows: [string, (p: PublicProperty) => React.ReactNode][] = [
    ['Price', (p) => fmtPrice(p)],
    ['Location', (p) => placeLine(p) || '—'],
    ['Type', (p) => label(p.property_type) || '—'],
    ['Bedrooms', (p) => p.bedrooms ?? 'Not stated'],
    ['Bathrooms', (p) => p.bathrooms ?? 'Not stated'],
    ['Size', (p) => (p.size_sqm ? `${p.size_sqm} m²` : 'Not stated')],
    ['Furnishing', (p) => label(p.furnishing) || 'Not stated'],
    ['Amenities', (p) => (p.amenities?.length ? p.amenities.map(label).join(', ') : 'Not stated')],
    ['Rent advance', (p) => (p.purpose === 'rent' ? (p.advance_months != null ? `${p.advance_months} months` : 'Ask the agency') : '—')],
    ['Fees', (p) => p.public_fees || 'Ask the agency'],
    ['Status', (p) => p.availability.label],
  ];
  return (
    <>
      {gone > 0 && <div className="s-note" style={{ marginBottom: 16 }}>{gone} saved listing{gone > 1 ? 's are' : ' is'} no longer available and {gone > 1 ? 'were' : 'was'} hidden.</div>}
      {cmp.length > 1 && (
        <section className="s-section" style={{ paddingTop: 0 }} aria-labelledby="cmp-h">
          <div className="s-section-head"><h2 id="cmp-h">Compare</h2></div>
          <div className="s-compare">
            <table>
              <thead><tr><th scope="col"><span className="s-sr">Feature</span></th>{cmp.map((p) => <th scope="col" key={p.id} style={{ color: 'var(--s-text)', fontWeight: 650, width: 'auto' }}><a href={propertyPath(slug, p)}>{p.title}</a></th>)}</tr></thead>
              <tbody>{rows.map(([k, f]) => <tr key={k}><th scope="row">{k}</th>{cmp.map((p) => <td key={p.id}>{f(p)}</td>)}</tr>)}</tbody>
            </table>
          </div>
          <p className="s-hint" style={{ marginTop: 8 }}>“Not stated” means the agency hasn't listed it — ask them to confirm.</p>
        </section>
      )}
      <div className="s-grid">{items.map((p) => <PropertyCard key={p.id} slug={slug} p={p} />)}</div>
    </>
  );
}
