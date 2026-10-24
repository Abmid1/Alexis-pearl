import { I } from '@/components/Icons';
import { PublicProperty, fmtPrice, label, placeLine, propertyPath } from '@/lib/publicApi';
import SaveButton from './SaveButton';

export function availabilityTone(code: string) {
  if (code === 'available') return 'ok';
  if (['reserved', 'under_offer', 'unavailable'].includes(code)) return 'warn';
  return 'bad';
}

export function Placeholder({ text = 'Photos coming soon' }: { text?: string }) {
  return (
    <div className="s-ph" role="img" aria-label={text}>
      <div><I name="image" size={30} /><span>{text}</span></div>
    </div>
  );
}

/** Listing card. The whole card links to the detail page; the save button sits above the link. */
export default function PropertyCard({ slug, p, priority = false }: { slug: string; p: PublicProperty; priority?: boolean }) {
  const href = propertyPath(slug, p);
  const tone = availabilityTone(p.availability.code);
  const price = fmtPrice(p);
  const [amount, period] = price.split(' / ');
  return (
    <article className="s-card">
      <div className="s-card-media">
        {p.images[0]
          ? <img src={p.images[0]} alt="" loading={priority ? 'eager' : 'lazy'} decoding="async" sizes="(min-width:1024px) 33vw, (min-width:640px) 50vw, 100vw" />
          : <Placeholder />}
        <div className="s-badges">
          <span className="s-badge">{p.purpose === 'rent' ? 'For rent' : 'For sale'}</span>
          {p.availability.code !== 'available' && <span className={`s-badge s-badge-${tone}`}>{p.availability.label}</span>}
        </div>
        <SaveButton slug={slug} id={p.id} title={p.title} />
      </div>
      <div className="s-card-body">
        <div className="s-card-price">{amount}{period && <small> / {period}</small>}</div>
        <h3 className="s-card-title"><a href={href}>{p.title}</a></h3>
        {placeLine(p) && <div className="s-card-place"><I name="pin" size={14} /> {placeLine(p)}</div>}
        <div className="s-facts">
          {p.bedrooms != null && <span><I name="bed" size={15} /> {p.bedrooms} {p.bedrooms === 1 ? 'bed' : 'beds'}</span>}
          {p.bathrooms != null && <span><I name="bath" size={15} /> {p.bathrooms} {p.bathrooms === 1 ? 'bath' : 'baths'}</span>}
          {p.property_type && <span><I name="home" size={14} /> {label(p.property_type)}</span>}
          {p.furnishing && <span><I name="sofa" size={15} /> {label(p.furnishing)}</span>}
        </div>
      </div>
    </article>
  );
}
