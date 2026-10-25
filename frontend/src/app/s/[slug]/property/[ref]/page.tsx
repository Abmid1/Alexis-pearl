import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getSite, getListing, idFromRef, fmtPrice, label, placeLine, propertyPath, slugify, whatsappLink } from '@/lib/publicApi';
import Gallery from '@/components/site/Gallery';
import EnquiryForm from '@/components/site/EnquiryForm';
import ViewingBooker from '@/components/site/ViewingBooker';
import SaveButton from '@/components/site/SaveButton';
import PropertyCard, { availabilityTone } from '@/components/site/PropertyCard';
import Assistant from '@/components/site/Assistant';
import { I } from '@/components/Icons';

export const revalidate = 30;

async function load(slug: string, ref: string) {
  const id = idFromRef(ref);
  if (!id) return null;
  const [site, data] = await Promise.all([getSite(slug), getListing(slug, id)]);
  return site && data ? { site, ...data } : null;
}

export async function generateMetadata({ params }: { params: { slug: string; ref: string } }): Promise<Metadata> {
  const d = await load(params.slug, params.ref).catch(() => null);
  if (!d) return { title: 'Listing not available', robots: { index: false } };
  const p = d.property;
  const description = [fmtPrice(p), p.bedrooms != null && `${p.bedrooms} bed`, placeLine(p), p.availability.label].filter(Boolean).join(' · ')
    + (p.description ? ` — ${p.description.slice(0, 120)}` : '');
  const url = propertyPath(params.slug, p);
  return {
    title: p.title,
    description,
    alternates: { canonical: url },
    openGraph: { title: `${p.title} · ${fmtPrice(p)}`, description, type: 'website', url, images: p.images.slice(0, 1) },
    twitter: { card: p.images[0] ? 'summary_large_image' : 'summary', title: p.title, description, images: p.images.slice(0, 1) },
  };
}

export default async function PropertyPage({ params }: { params: { slug: string; ref: string } }) {
  const d = await load(params.slug, params.ref);
  if (!d) notFound();
  const { site, property: p, related } = d;
  const c = site.company;
  // keep one canonical, readable URL (old or bare-id links still work)
  if (params.ref !== `${slugify(p.title)}-${p.id}`) redirect(propertyPath(c.slug, p));

  const base = `/s/${c.slug}`;
  const tone = availabilityTone(p.availability.code);
  const [amount, period] = fmtPrice(p).split(' / ');
  const wa = whatsappLink(c.whatsapp, `Hello ${c.name}, I'm interested in "${p.title}" (${fmtPrice(p)}).`);
  const confirmed = p.availability_confirmed_at ? new Date(p.availability_confirmed_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Accra' }) : null;
  const specs: [string, string][] = [
    ['Price', fmtPrice(p)],
    ['Type', label(p.property_type) || (p.purpose === 'rent' ? 'Rental' : 'For sale')],
    ['Bedrooms', p.bedrooms != null ? String(p.bedrooms) : 'Not stated'],
    ['Bathrooms', p.bathrooms != null ? String(p.bathrooms) : 'Not stated'],
    ['Size', p.size_sqm ? `${p.size_sqm} m²` : 'Not stated'],
    ['Furnishing', label(p.furnishing) || 'Not stated'],
    ...(p.purpose === 'rent' ? [['Rent advance', p.advance_months != null ? `${p.advance_months} month${p.advance_months === 1 ? '' : 's'}` : 'Ask the agency'] as [string, string]] : []),
    ['Status', p.availability.label],
  ];
  const jsonLd = {
    '@context': 'https://schema.org', '@type': 'RealEstateListing', name: p.title, url: propertyPath(c.slug, p),
    image: p.images.slice(0, 5), datePosted: p.published_at || undefined,
    offers: { '@type': 'Offer', price: p.price, priceCurrency: 'GHS', availability: p.availability.can_enquire ? 'https://schema.org/InStock' : 'https://schema.org/SoldOut', seller: { '@type': 'RealEstateAgent', name: c.name } },
  };

  return (
    <div className={p.availability.can_enquire ? 's-has-bar' : ''}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />
      <div className="s-wrap">
        <nav className="s-crumbs" aria-label="Breadcrumb">
          <a href={base}>Home</a><span aria-hidden="true">/</span>
          <a href={`${base}/properties?purpose=${p.purpose}`}>{p.purpose === 'rent' ? 'To rent' : 'For sale'}</a><span aria-hidden="true">/</span>
          <span aria-current="page">{p.title}</span>
        </nav>

        <Gallery images={p.images} title={p.title} />

        <div className="s-detail">
          <article>
            <div className="s-status" style={{ marginBottom: 10 }}>
              <span className={`s-badge s-badge-${tone}`}>{p.availability.label}</span>
              <span className="s-badge">{p.purpose === 'rent' ? 'For rent' : 'For sale'}</span>
              {p.property_type && <span className="s-badge">{label(p.property_type)}</span>}
            </div>
            <h1>{p.title}</h1>
            {placeLine(p) && <p className="s-card-place" style={{ fontSize: 16 }}><I name="pin" size={17} /> {[p.location, placeLine(p)].filter((x, i, a) => x && a.indexOf(x) === i).join(' · ')}</p>}

            {!p.availability.can_enquire && (
              <div className="s-note" role="status" style={{ marginTop: 16 }}>
                This property is <b>{p.availability.label.toLowerCase()}</b> and isn't taking new enquiries. {related.length ? 'Have a look at similar listings below.' : `Ask ${c.name} about similar properties.`}
              </div>
            )}

            <dl className="s-specs">{specs.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>

            {p.description && (
              <section className="s-block"><h2>About this property</h2><p className="s-prose">{p.description}</p></section>
            )}

            {!!p.amenities?.length && (
              <section className="s-block"><h2>Amenities</h2>
                <ul className="s-amenities">{p.amenities.map((a) => <li key={a}><I name="check" size={17} /> {label(a)}</li>)}</ul>
                <p className="s-hint" style={{ marginTop: 12 }}>Only amenities the agency has listed are shown. Ask about anything else.</p>
              </section>
            )}

            <section className="s-block"><h2>Costs</h2>
              <p style={{ fontSize: 16 }}><b>{fmtPrice(p)}</b>{p.purpose === 'rent' && p.advance_months ? ` · ${p.advance_months} months' rent in advance` : ''}</p>
              <p className="s-hint" style={{ marginTop: 6, fontSize: 15 }}>{p.public_fees || 'The agency has not listed additional fees. Ask about agency, legal or service charges before you commit.'}</p>
            </section>

            {p.map && (
              <section className="s-block"><h2>Location</h2>
                <iframe className="s-map" title={`Map of ${p.title}`} loading="lazy" referrerPolicy="no-referrer"
                  src={`https://www.google.com/maps?q=${p.map.lat},${p.map.lng}&z=15&output=embed`} />
              </section>
            )}

            <section className="s-block" id="book" style={{ scrollMarginTop: 80 }}>
              <h2>Request a viewing</h2>
              {p.availability.can_book_viewing
                ? <ViewingBooker slug={c.slug} companyName={c.name} propertyId={p.id} propertyTitle={p.title} />
                : <div className="s-note">Viewings aren't open for this property right now ({p.availability.label.toLowerCase()}).{p.availability.can_enquire ? ' Send an enquiry and the agency will advise.' : ''}</div>}
            </section>

            <section className="s-block">
              <div className="s-note">
                <b>Before you pay anything:</b> listing details are provided by {c.name}. Bilt Africa has not verified ownership, title or land registration for this property. Inspect it in person, confirm documents with the Lands Commission, and use a lawyer for any sale or lease agreement.
              </div>
            </section>
          </article>

          <aside className="s-aside" aria-label="Price and contact">
            <div className="s-price-box" id="enquire" style={{ scrollMarginTop: 80 }}>
              <div className="s-price">{amount}{period && <small> / {period}</small>}</div>
              <div className="s-status">
                <span className={`s-dot ${tone === 'ok' ? '' : tone}`} /> {p.availability.label}
                {confirmed && <span className="s-hint">· checked by the agency on {confirmed}</span>}
              </div>
              {p.availability.can_book_viewing && <a className="s-btn s-btn-primary s-btn-block" href="#book"><I name="calendar" size={18} /> Request a viewing</a>}
              {['available', 'under_offer'].includes(p.availability.code) && (
                <a className="s-btn s-btn-ghost s-btn-block" href={`${base}/apply/${slugify(p.title)}-${p.id}`}><I name="doc" size={18} /> Apply {p.purpose === 'rent' ? 'to rent' : 'to buy'}</a>
              )}
              <SaveButton slug={c.slug} id={p.id} title={p.title} variant="button" />
              {p.availability.can_enquire ? (
                <>
                  <hr style={{ border: 0, borderTop: '1px solid var(--s-line)' }} />
                  <h2 style={{ fontSize: 17 }}>Ask {c.name}</h2>
                  <EnquiryForm slug={c.slug} companyName={c.name} propertyId={p.id} propertyTitle={p.title} compact />
                </>
              ) : (
                <a className="s-btn s-btn-ghost s-btn-block" href={`${base}/properties?purpose=${p.purpose}`}>See similar listings</a>
              )}
              <div className="s-contact-list" style={{ fontSize: 14 }}>
                {c.contact_phone && <a href={`tel:${c.contact_phone}`}><I name="phone" size={16} /> Call {c.contact_phone}</a>}
                {wa && <a href={wa} target="_blank" rel="noopener noreferrer"><I name="chat" size={16} /> WhatsApp the agency</a>}
              </div>
            </div>
          </aside>
        </div>

        {related.length > 0 && (
          <section className="s-section" style={{ paddingTop: 0 }} aria-labelledby="rel-h">
            <div className="s-section-head"><h2 id="rel-h">Similar listings</h2></div>
            <div className="s-grid">{related.map((r) => <PropertyCard key={r.id} slug={c.slug} p={r} />)}</div>
          </section>
        )}
      </div>

      {p.availability.can_enquire && (
        <div className="s-mobile-bar">
          <div className="s-price-mini">{amount}{period && <small>per {period}</small>}{!period && <small>{p.availability.label}</small>}</div>
          {p.availability.can_book_viewing
            ? <a className="s-btn s-btn-primary s-btn-sm" href="#book">Request viewing</a>
            : <a className="s-btn s-btn-primary s-btn-sm" href="#enquire">Enquire</a>}
        </div>
      )}
      <Assistant slug={c.slug} companyName={c.name} propertyId={p.id} />
    </div>
  );
}
