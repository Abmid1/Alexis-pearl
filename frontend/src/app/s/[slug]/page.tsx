import { notFound } from 'next/navigation';
import { getSite, label, whatsappLink } from '@/lib/publicApi';
import PropertyCard from '@/components/site/PropertyCard';
import SearchForm from '@/components/site/SearchForm';
import EnquiryForm from '@/components/site/EnquiryForm';
import Assistant from '@/components/site/Assistant';
import { I } from '@/components/Icons';

export const revalidate = 30;

const TYPE_ICON: Record<string, string> = { apartment: 'building', house: 'home', townhouse: 'home', duplex: 'home', land: 'land', commercial: 'briefcase', office: 'briefcase' };

export default async function AgencyHome({ params }: { params: { slug: string } }) {
  const site = await getSite(params.slug);
  if (!site) notFound();
  const { company: c, facets, featured } = site;
  const base = `/s/${c.slug}`;
  const wa = whatsappLink(c.whatsapp, `Hello ${c.name}, I'd like help finding a property.`);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const viewingDays = c.viewing_policy.days.length === 7 ? 'every day' : c.viewing_policy.days.map((d) => days[d]).join(', ');

  return (
    <>
      <section className="s-hero">
        <div className="s-wrap">
          <div className="s-hero-panel">
            <div className="s-eyebrow">{c.name}</div>
            <h1>{c.tagline || 'Find your next home with people who know the area.'}</h1>
            <p className="s-lead">
              {facets.total
                ? `Browse ${facets.total} current listing${facets.total === 1 ? '' : 's'}, request a viewing in a few taps, and hear back from a real agent.`
                : `Tell us what you're looking for and an agent from ${c.name} will help you find it.`}
            </p>
            <SearchForm slug={c.slug} facets={facets} services={c.services} />
          </div>
        </div>
      </section>

      <section className="s-section" aria-labelledby="featured-h">
        <div className="s-wrap">
          <div className="s-section-head">
            <div><h2 id="featured-h">Latest listings</h2><p>Published by {c.name} and checked by their team.</p></div>
            {facets.total > featured.length && <a className="s-btn s-btn-ghost s-btn-sm" href={`${base}/properties`}>See all {facets.total} <I name="arrowRight" size={16} /></a>}
          </div>
          {featured.length ? (
            <div className="s-grid">{featured.map((p, i) => <PropertyCard key={p.id} slug={c.slug} p={p} priority={i < 3} />)}</div>
          ) : (
            <div className="s-empty">
              <h3>New listings are on the way</h3>
              <p>{c.name} hasn't published listings here yet. Send a message with what you need and they'll let you know when something fits.</p>
              <a className="s-btn s-btn-primary" href="#contact">Tell us what you're looking for</a>
            </div>
          )}
        </div>
      </section>

      {(facets.types.length > 0 || facets.locations.length > 0) && (
        <section className="s-section" style={{ paddingTop: 0 }} aria-labelledby="browse-h">
          <div className="s-wrap">
            <div className="s-section-head"><h2 id="browse-h">Browse by category</h2></div>
            <div className="s-tiles" style={{ marginBottom: 22 }}>
              {facets.purposes.rent ? (
                <a className="s-tile" href={`${base}/properties?purpose=rent`}><span className="s-tile-icon"><I name="key2" size={19} /></span><span><b>To rent</b><br /><small>{facets.purposes.rent} listing{facets.purposes.rent === 1 ? '' : 's'}</small></span></a>
              ) : null}
              {facets.purposes.buy ? (
                <a className="s-tile" href={`${base}/properties?purpose=buy`}><span className="s-tile-icon"><I name="home" size={19} /></span><span><b>For sale</b><br /><small>{facets.purposes.buy} listing{facets.purposes.buy === 1 ? '' : 's'}</small></span></a>
              ) : null}
              {facets.types.slice(0, 4).map((t) => (
                <a key={t.key} className="s-tile" href={`${base}/properties?type=${t.key}`}><span className="s-tile-icon"><I name={TYPE_ICON[t.key] || 'building'} size={19} /></span><span><b>{label(t.key)}</b><br /><small>{t.count} listing{t.count === 1 ? '' : 's'}</small></span></a>
              ))}
            </div>
            {facets.locations.length > 0 && (
              <>
                <h3 style={{ fontSize: 16, marginBottom: 12 }}>Popular areas</h3>
                <div className="s-chips">
                  {facets.locations.slice(0, 12).map((l) => (
                    <a key={l.name} className="s-chip" href={`${base}/properties?q=${encodeURIComponent(l.name)}`}><I name="pin" size={15} /> {l.name} <em>{l.count}</em></a>
                  ))}
                </div>
              </>
            )}
          </div>
        </section>
      )}

      <section className="s-section" aria-labelledby="about-h">
        <div className="s-wrap s-split">
          <div>
            <div className="s-eyebrow">About us</div>
            <h2 id="about-h" style={{ fontSize: 'clamp(24px,3vw,32px)', marginBottom: 14 }}>{c.name}</h2>
            <p className="s-prose">{c.about || `${c.name} is a real estate agency helping people buy, rent and invest in property.`}</p>
            {c.services.length > 0 && (
              <div className="s-chips" style={{ marginTop: 20 }}>
                {c.services.map((s) => <span key={s} className="s-chip" style={{ cursor: 'default' }}>{({ buy: 'Homes for sale', rent: 'Rentals', land: 'Land', sell: 'Sell your property', management: 'Property management', valuation: 'Valuations' } as Record<string, string>)[s] || label(s)}</span>)}
              </div>
            )}
          </div>
          <ul className="s-trust" aria-label="How we work">
            <li><span className="s-tile-icon"><I name="shield" size={19} /></span><div><b>Listings managed by our team</b><p>Every listing is approved by {c.name} staff, and we show when availability was last checked.</p></div></li>
            <li><span className="s-tile-icon"><I name="calendar" size={19} /></span><div><b>Viewings confirmed by a person</b><p>Pick a time online ({viewingDays}, {c.viewing_policy.start}–{c.viewing_policy.end}). An agent confirms it before it's booked.</p></div></li>
            <li><span className="s-tile-icon"><I name="chat" size={19} /></span><div><b>Track every request</b><p>Use your reference to see replies and viewing status at any time — no account needed.</p></div></li>
            <li><span className="s-tile-icon"><I name="user" size={19} /></span><div><b>Your details stay with us</b><p>Enquiries go only to {c.name}. We contact you only about your request.</p></div></li>
          </ul>
        </div>
      </section>

      <section className="s-section" id="contact" aria-labelledby="contact-h">
        <div className="s-wrap s-split">
          <div className="s-panel">
            <h2 id="contact-h" style={{ fontSize: 24, marginBottom: 6 }}>Tell us what you're looking for</h2>
            <p className="s-hint" style={{ marginBottom: 18, fontSize: 15 }}>Area, budget, number of bedrooms, move-in date — an agent will reply.</p>
            <EnquiryForm slug={c.slug} companyName={c.name} />
          </div>
          <div style={{ display: 'grid', gap: 16 }}>
            <div className="s-panel">
              <h3 style={{ fontSize: 17, marginBottom: 8 }}>Contact {c.name}</h3>
              <div className="s-contact-list">
                {c.contact_phone && <a href={`tel:${c.contact_phone}`}><I name="phone" size={18} /> {c.contact_phone}</a>}
                {wa && <a href={wa} target="_blank" rel="noopener noreferrer"><I name="chat" size={18} /> Chat on WhatsApp</a>}
                {c.contact_email && <a href={`mailto:${c.contact_email}`}><I name="mail" size={18} /> {c.contact_email}</a>}
                {c.address && <div><I name="pin" size={18} /> {c.address}</div>}
                {c.office_hours && <div><I name="clock" size={18} /> {c.office_hours}</div>}
              </div>
            </div>
            <div className="s-cta">
              <div><h3 style={{ fontSize: 20, marginBottom: 6 }}>Already sent a request?</h3><p>Check replies and viewing status with your reference.</p></div>
              <a className="s-btn s-btn-ghost" href={`${base}/track`}>Track my request</a>
            </div>
          </div>
        </div>
      </section>

      <Assistant slug={c.slug} companyName={c.name} />
    </>
  );
}
