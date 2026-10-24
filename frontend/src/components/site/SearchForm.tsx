import { Facets, label } from '@/lib/publicApi';
import { I } from '@/components/Icons';

/**
 * Homepage search. A plain GET form: works without JavaScript, results are
 * server-rendered and shareable as a URL.
 */
export default function SearchForm({ slug, facets, services }: { slug: string; facets: Facets; services: string[] }) {
  const canBuy = services.includes('buy') || services.includes('land') || !!facets.purposes.buy;
  const canRent = services.includes('rent') || !!facets.purposes.rent;
  const defaultPurpose = canRent && (facets.purposes.rent || 0) >= (facets.purposes.buy || 0) ? 'rent' : 'buy';
  return (
    <form className="s-search" action={`/s/${slug}/properties`} method="get" role="search" aria-label="Search listings">
      {canBuy && canRent ? (
        <fieldset className="s-field" style={{ border: 0, padding: 0 }}>
          <legend className="s-sr">Rent or buy</legend>
          <div className="s-seg">
            <label><input type="radio" name="purpose" value="rent" defaultChecked={defaultPurpose === 'rent'} /><span>Rent</span></label>
            <label><input type="radio" name="purpose" value="buy" defaultChecked={defaultPurpose === 'buy'} /><span>Buy</span></label>
          </div>
        </fieldset>
      ) : <input type="hidden" name="purpose" value={canRent ? 'rent' : 'buy'} />}
      <label className="s-field">
        <span className="s-sr">Location</span>
        <input className="s-input" name="q" list={`loc-${slug}`} placeholder="Area or town, e.g. East Legon" autoComplete="off" />
        <datalist id={`loc-${slug}`}>{facets.locations.map((l) => <option key={l.name} value={l.name} />)}</datalist>
      </label>
      <label className="s-field">
        <span className="s-sr">Property type</span>
        <select className="s-select" name="type" defaultValue="">
          <option value="">Any type</option>
          {facets.types.map((t) => <option key={t.key} value={t.key}>{label(t.key)}</option>)}
        </select>
      </label>
      <label className="s-field">
        <span className="s-sr">Bedrooms</span>
        <select className="s-select" name="beds" defaultValue="">
          <option value="">Any bedrooms</option>
          {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}+ bedrooms</option>)}
        </select>
      </label>
      <button className="s-btn s-btn-primary"><I name="search" size={18} /> Search</button>
    </form>
  );
}
