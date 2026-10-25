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

function Facts({ p, light = false }: { p: PublicProperty; light?: boolean }) {
  return (
    <div className={light ? 's-ocard-meta' : 's-facts'}>
      {p.bedrooms != null && <span><I name="bed" size={15} /> {p.bedrooms} {p.bedrooms === 1 ? 'bed' : 'beds'}</span>}
      {p.bathrooms != null && <span><I name="bath" size={15} /> {p.bathrooms} {p.bathrooms === 1 ? 'bath' : 'baths'}</span>}
      {p.size_sqm != null && <span><I name="ruler" size={15} /> {p.size_sqm} m²</span>}
      {p.bedrooms == null && p.bathrooms == null && p.property_type && <span><I name="home" size={14} /> {label(p.property_type)}</span>}
    </div>
  );
}

/**
 * Listing card.
 * `overlay` is the search-page style: photo fills the card with the details on top.
 * The default style keeps the photo above a white body, used on the homepage.
 */
export default function PropertyCard({ slug, p, priority = false, overlay = false }: {
  slug: string; p: PublicProperty; priority?: boolean; overlay?: boolean;
}) {
  const href = propertyPath(slug, p);
  const tone = availabilityTone(p.availability.code);
  const [amount, period] = fmtPrice(p).split(' / ');
  const img = p.images[0];
  const badges = (
    <div className="s-badges">
      <span className="s-badge">{p.purpose === 'rent' ? 'For rent' : 'For sale'}</span>
      {p.availability.code !== 'available' && <span className={`s-badge s-badge-${tone}`}>{p.availability.label}</span>}
    </div>
  );

  if (overlay) {
    return (
      <article className="s-ocard">
        {img
          ? <img src={img} alt="" loading={priority ? 'eager' : 'lazy'} decoding="async" sizes="(min-width:1280px) 25vw, (min-width:1000px) 33vw, (min-width:560px) 50vw, 100vw" />
          : <Placeholder />}
        {badges}
        <SaveButton slug={slug} id={p.id} title={p.title} />
        <div className="s-ocard-body">
          <div className="s-ocard-price">{amount}{period && <small> / {period}</small>}</div>
          <h3 className="s-ocard-title"><a href={href}>{p.title}</a></h3>
          {placeLine(p) && <div className="s-ocard-meta"><span><I name="pin" size={14} /> {placeLine(p)}</span></div>}
          <Facts p={p} light />
        </div>
      </article>
    );
  }

  return (
    <article className="s-card">
      <div className="s-card-media">
        {img
          ? <img src={img} alt="" loading={priority ? 'eager' : 'lazy'} decoding="async" sizes="(min-width:1024px) 33vw, (min-width:640px) 50vw, 100vw" />
          : <Placeholder />}
        {badges}
        <SaveButton slug={slug} id={p.id} title={p.title} />
      </div>
      <div className="s-card-body">
        <div className="s-card-price">{amount}{period && <small> / {period}</small>}</div>
        <h3 className="s-card-title"><a href={href}>{p.title}</a></h3>
        {placeLine(p) && <div className="s-card-place"><I name="pin" size={14} /> {placeLine(p)}</div>}
        <Facts p={p} />
      </div>
    </article>
  );
}
