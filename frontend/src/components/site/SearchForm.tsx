import { Facets, label } from '@/lib/publicApi';
import { I } from '@/components/Icons';

/**
 * Homepage search. A plain GET form: it works without JavaScript, the results are
 * server-rendered, and the URL can be shared.
 */
export default function SearchForm({ slug, facets, services }: { slug: string; facets: Facets; services: string[] }) {
  const canBuy = services.includes('buy') || services.includes('land') || !!facets.purposes.buy;
  const canRent = services.includes('rent') || !!facets.purposes.rent;
  const defaultPurpose = canRent && (facets.purposes.rent || 0) >= (facets.purposes.buy || 0) ? 'rent' : 'buy';

  return (
    <form action={`/s/${slug}/properties`} method="get" role="search" aria-label="Search listings">
      {canBuy && canRent ? (
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="s-sr">Rent or buy</legend>
          <div className="s-seg">
            <label><input type="radio" name="purpose" value="rent" defaultChecked={defaultPurpose === 'rent'} /><span>Rent</span></label>
            <label><input type="radio" name="purpose" value="buy" defaultChecked={defaultPurpose === 'buy'} /><span>Buy</span></label>
          </div>
        </fieldset>
      ) : <input type="hidden" name="purpose" value={canRent ? 'rent' : 'buy'} />}

      <div className="s-search">
        <label className="s-fb">
          <span>Where</span>
          <input name="q" list={`loc-${slug}`} placeholder="Area or town" autoComplete="off" />
          <datalist id={`loc-${slug}`}>{facets.locations.map((l) => <option key={l.name} value={l.name} />)}</datalist>
        </label>
        <label className="s-fb">
          <span>Type</span>
          <select name="type" defaultValue="">
            <option value="">Any type</option>
            {facets.types.map((t) => <option key={t.key} value={t.key}>{label(t.key)}</option>)}
          </select>
        </label>
        <label className="s-fb">
          <span>Max price (GHS)</span>
          <input name="max_price" type="number" min={0} inputMode="numeric" placeholder="No limit" />
        </label>
        <div className="s-search-go">
          <button className="s-btn s-btn-primary"><I name="search" size={18} /> Search</button>
        </div>
      </div>
    </form>
  );
}
