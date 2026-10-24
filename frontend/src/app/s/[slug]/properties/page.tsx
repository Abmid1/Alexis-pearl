import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getSite, searchListings, label } from '@/lib/publicApi';
import PropertyCard from '@/components/site/PropertyCard';
import Assistant from '@/components/site/Assistant';
import FilterPanel from '@/components/site/FilterPanel';
import { I } from '@/components/Icons';

export const revalidate = 30;
type SP = Record<string, string | string[] | undefined>;

const KEYS = ['purpose', 'type', 'q', 'min_price', 'max_price', 'beds', 'baths', 'furnishing', 'amenities', 'availability', 'sort', 'page'];
function toQS(sp: SP, override: Record<string, string | null> = {}) {
  const u = new URLSearchParams();
  for (const k of KEYS) {
    const v = k in override ? override[k] : sp[k];
    const val = Array.isArray(v) ? v.join(',') : v;
    if (val) u.set(k, String(val).slice(0, 120));
  }
  return u.toString();
}

function heading(sp: SP) {
  const t = typeof sp.type === 'string' && sp.type ? label(sp.type) + 's' : 'Properties';
  const p = sp.purpose === 'rent' ? ' to rent' : sp.purpose === 'buy' ? ' for sale' : '';
  const q = typeof sp.q === 'string' && sp.q ? ` in ${sp.q.slice(0, 40)}` : '';
  return `${t}${p}${q}`;
}

export async function generateMetadata({ params, searchParams }: { params: { slug: string }; searchParams: SP }): Promise<Metadata> {
  const h = heading(searchParams);
  const filtered = Object.keys(searchParams).some((k) => k !== 'purpose');
  return { title: h, robots: filtered ? { index: false, follow: true } : undefined, alternates: { canonical: `/s/${params.slug}/properties${searchParams.purpose ? `?purpose=${searchParams.purpose}` : ''}` } };
}

export default async function Listings({ params, searchParams }: { params: { slug: string }; searchParams: SP }) {
  const [site, res] = await Promise.all([getSite(params.slug), searchListings(params.slug, toQS(searchParams))]);
  if (!site || !res) notFound();
  const c = site.company;
  const base = `/s/${c.slug}`;
  const f = res.filters || {};
  const amen = new Set<string>(f.amenities || []);
  const val = (k: string) => (typeof searchParams[k] === 'string' ? (searchParams[k] as string) : '');
  const active = KEYS.filter((k) => !['sort', 'page'].includes(k) && val(k)).length;

  return (
    <div className="s-wrap">
      <div className="s-page-head">
        <h1>{heading(searchParams)}</h1>
        <p>{res.total} listing{res.total === 1 ? '' : 's'} from {c.name}</p>
      </div>

      <div className="s-layout">
        <FilterPanel startOpen={active > 0}>
          <summary>Filters {active > 0 && <span className="s-badge s-badge-accent">{active}</span>}<span className="s-hint" aria-hidden="true">Tap to {active ? 'edit' : 'open'}</span></summary>
          <form className="s-filters-body" method="get" action={`${base}/properties`} aria-label="Filter listings">
            <label className="s-field"><span>Looking to</span>
              <select className="s-select" name="purpose" defaultValue={val('purpose')}>
                <option value="">Rent or buy</option><option value="rent">Rent</option><option value="buy">Buy</option>
              </select></label>
            <label className="s-field"><span>Area or town</span>
              <input className="s-input" name="q" defaultValue={val('q')} list="filter-locs" placeholder="e.g. Spintex" />
              <datalist id="filter-locs">{site.facets.locations.map((l) => <option key={l.name} value={l.name} />)}</datalist></label>
            <label className="s-field"><span>Property type</span>
              <select className="s-select" name="type" defaultValue={val('type')}>
                <option value="">Any</option>
                {site.facets.types.map((t) => <option key={t.key} value={t.key}>{label(t.key)} ({t.count})</option>)}
              </select></label>
            <div className="s-row2">
              <label className="s-field"><span>Min price (GHS)</span><input className="s-input" name="min_price" type="number" min={0} inputMode="numeric" defaultValue={val('min_price')} /></label>
              <label className="s-field"><span>Max price (GHS)</span><input className="s-input" name="max_price" type="number" min={0} inputMode="numeric" defaultValue={val('max_price')} /></label>
            </div>
            <div className="s-row2">
              <label className="s-field"><span>Bedrooms</span>
                <select className="s-select" name="beds" defaultValue={val('beds')}><option value="">Any</option>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}+</option>)}</select></label>
              <label className="s-field"><span>Bathrooms</span>
                <select className="s-select" name="baths" defaultValue={val('baths')}><option value="">Any</option>{[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}+</option>)}</select></label>
            </div>
            <label className="s-field"><span>Furnishing</span>
              <select className="s-select" name="furnishing" defaultValue={val('furnishing')}>
                <option value="">Any</option><option value="furnished">Furnished</option><option value="semi_furnished">Semi-furnished</option><option value="unfurnished">Unfurnished</option>
              </select></label>
            {site.facets.amenities.length > 0 && (
              <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
                <legend className="s-label" style={{ marginBottom: 8 }}>Must have</legend>
                <div className="s-amen">
                  {site.facets.amenities.map((a) => (
                    <label key={a.key}><input type="checkbox" name="amenities" value={a.key} defaultChecked={amen.has(a.key)} /><span>{label(a.key)}</span></label>
                  ))}
                </div>
              </fieldset>
            )}
            <label className="s-field"><span>Availability</span>
              <select className="s-select" name="availability" defaultValue={val('availability')}>
                <option value="">Current listings</option><option value="available">Available now only</option><option value="all">Include sold & rented</option>
              </select></label>
            <input type="hidden" name="sort" value={val('sort')} />
            <button className="s-btn s-btn-primary s-btn-block">Show results</button>
            {active > 0 && <a className="s-btn s-btn-quiet s-btn-block" style={{ marginTop: 6 }} href={`${base}/properties`}>Clear all filters</a>}
          </form>
        </FilterPanel>

        <section aria-label="Results">
          <div className="s-results-bar">
            <p>{res.total ? `Showing ${(res.page - 1) * res.per + 1}–${Math.min(res.page * res.per, res.total)} of ${res.total}` : 'No matches'}</p>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} role="group" aria-label="Sort">
              {[['newest', 'Newest'], ['price_asc', 'Price ↑'], ['price_desc', 'Price ↓']].map(([k, l]) => {
                const on = (val('sort') || 'newest') === k;
                return <a key={k} className={`s-btn s-btn-sm ${on ? 's-btn-primary' : 's-btn-ghost'}`} aria-current={on ? 'true' : undefined} href={`${base}/properties?${toQS(searchParams, { sort: k, page: null })}`}>{l}</a>;
              })}
            </div>
          </div>

          {res.items.length ? (
            <div className="s-grid">{res.items.map((p, i) => <PropertyCard key={p.id} slug={c.slug} p={p} priority={i < 2} />)}</div>
          ) : (
            <div className="s-empty">
              <span className="s-tile-icon"><I name="search" size={19} /></span>
              <h2>No listings match those filters</h2>
              <p>Try a wider area or budget, or tell {c.name} what you need — they often know about properties before they're listed.</p>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
                <a className="s-btn s-btn-ghost" href={`${base}/properties`}>Clear filters</a>
                <a className="s-btn s-btn-primary" href={`${base}#contact`}>Ask the agency</a>
              </div>
            </div>
          )}

          {res.pages > 1 && (
            <nav className="s-pager" aria-label="Pages">
              {res.page > 1 && <a className="s-btn s-btn-ghost s-btn-sm" rel="prev" href={`${base}/properties?${toQS(searchParams, { page: String(res.page - 1) })}`}><I name="chevronLeft" size={16} /> Previous</a>}
              <span>Page {res.page} of {res.pages}</span>
              {res.page < res.pages && <a className="s-btn s-btn-ghost s-btn-sm" rel="next" href={`${base}/properties?${toQS(searchParams, { page: String(res.page + 1) })}`}>Next <I name="chevronRight" size={16} /></a>}
            </nav>
          )}
        </section>
      </div>
      <Assistant slug={c.slug} companyName={c.name} />
    </div>
  );
}
