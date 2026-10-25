import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getSite, searchListings, label } from '@/lib/publicApi';
import PropertyCard from '@/components/site/PropertyCard';
import Assistant from '@/components/site/Assistant';
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
  const t = typeof sp.type === 'string' && sp.type ? `${label(sp.type)}s` : 'Properties';
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
  const advancedKeys = ['baths', 'furnishing', 'amenities', 'availability'];
  const activeKeys = KEYS.filter((k) => !['sort', 'page'].includes(k) && val(k));
  const advancedOpen = advancedKeys.some((k) => val(k));

  return (
    <>
      <div className="s-wrap">
        <header className="s-search-head">
          <h1>{heading(searchParams)}</h1>
          <p>{c.tagline || `Find your next home with ${c.name}.`}</p>
        </header>

        {/* Plain GET form: results are server-rendered and the URL can be shared */}
        <form className="s-fbar" method="get" action={`${base}/properties`} role="search" aria-label="Search listings">
          <div className="s-fbar-row">
            <label className="s-fb">
              <span>Location</span>
              <input name="q" defaultValue={val('q')} list="fb-locs" placeholder="Any area" autoComplete="off" />
              <datalist id="fb-locs">{site.facets.locations.map((l) => <option key={l.name} value={l.name} />)}</datalist>
            </label>
            <label className="s-fb">
              <span>Type</span>
              <select name="type" defaultValue={val('type')}>
                <option value="">Any</option>
                {site.facets.types.map((t) => <option key={t.key} value={t.key}>{label(t.key)} ({t.count})</option>)}
              </select>
            </label>
            <label className="s-fb">
              <span>Bedrooms</span>
              <select name="beds" defaultValue={val('beds')}>
                <option value="">Any</option>
                {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}+</option>)}
              </select>
            </label>
            <div className="s-fb">
              <span>Price (GHS)</span>
              <div className="s-fb-pair">
                <input name="min_price" type="number" min={0} inputMode="numeric" placeholder="From" defaultValue={val('min_price')} aria-label="Minimum price" />
                <em>–</em>
                <input name="max_price" type="number" min={0} inputMode="numeric" placeholder="To" defaultValue={val('max_price')} aria-label="Maximum price" />
              </div>
            </div>
            <div className="s-fbar-go">
              <button className="s-btn s-btn-primary"><I name="search" size={18} /> Filter results</button>
            </div>
          </div>

          <details className="s-adv" open={advancedOpen || undefined}>
            <summary><I name="more" size={16} /> Advanced filters</summary>
            <div className="s-adv-grid">
              <label className="s-fb">
                <span>Looking to</span>
                <select name="purpose" defaultValue={val('purpose')}>
                  <option value="">Rent or buy</option><option value="rent">Rent</option><option value="buy">Buy</option>
                </select>
              </label>
              <label className="s-fb">
                <span>Bathrooms</span>
                <select name="baths" defaultValue={val('baths')}>
                  <option value="">Any</option>{[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}+</option>)}
                </select>
              </label>
              <label className="s-fb">
                <span>Furnishing</span>
                <select name="furnishing" defaultValue={val('furnishing')}>
                  <option value="">Any</option><option value="furnished">Furnished</option><option value="semi_furnished">Semi-furnished</option><option value="unfurnished">Unfurnished</option>
                </select>
              </label>
              <label className="s-fb">
                <span>Availability</span>
                <select name="availability" defaultValue={val('availability')}>
                  <option value="">Current listings</option><option value="available">Available now</option><option value="all">Include sold &amp; rented</option>
                </select>
              </label>
            </div>
            {site.facets.amenities.length > 0 && (
              <fieldset style={{ border: 0, padding: 0, margin: '14px 0 0' }}>
                <legend className="s-label" style={{ marginBottom: 8 }}>Must have</legend>
                <div className="s-amen">
                  {site.facets.amenities.map((a) => (
                    <label key={a.key}><input type="checkbox" name="amenities" value={a.key} defaultChecked={amen.has(a.key)} /><span>{label(a.key)}</span></label>
                  ))}
                </div>
              </fieldset>
            )}
          </details>

          <input type="hidden" name="sort" value={val('sort')} />
          <div className="s-fbar-foot">
            <span className="s-hint">
              {activeKeys.length
                ? <span className="s-chip-clear"><I name="check" size={14} /> {activeKeys.length} filter{activeKeys.length === 1 ? '' : 's'} applied</span>
                : `${site.facets.total} listing${site.facets.total === 1 ? '' : 's'} from ${c.name}`}
            </span>
            {activeKeys.length > 0 && <a className="s-btn s-btn-quiet" href={`${base}/properties`}>Clear all</a>}
          </div>
        </form>

        <div className="s-toolbar">
          <h2>{res.total ? `${res.total} result${res.total === 1 ? '' : 's'}` : 'No matches'}
            {res.total > res.per && <span className="s-hint" style={{ fontWeight: 400 }}> · page {res.page} of {res.pages}</span>}
          </h2>
          <div className="s-sort" role="group" aria-label="Sort">
            {[['newest', 'Newest'], ['price_asc', 'Price low to high'], ['price_desc', 'Price high to low']].map(([k, l]) => {
              const on = (val('sort') || 'newest') === k;
              return <a key={k} className="s-pill" aria-current={on ? 'true' : undefined} href={`${base}/properties?${toQS(searchParams, { sort: k, page: null })}`}>{l}</a>;
            })}
          </div>
        </div>

        {res.items.length ? (
          <div className="s-grid-4">{res.items.map((p, i) => <PropertyCard key={p.id} slug={c.slug} p={p} priority={i < 4} overlay />)}</div>
        ) : (
          <div className="s-empty">
            <span className="s-tile-icon"><I name="search" size={19} /></span>
            <h2>No listings match those filters</h2>
            <p>Try a wider area or budget, or tell {c.name} what you need — they often know about properties before they are listed.</p>
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
        <div style={{ height: 48 }} />
      </div>
      <Assistant slug={c.slug} companyName={c.name} />
    </>
  );
}
