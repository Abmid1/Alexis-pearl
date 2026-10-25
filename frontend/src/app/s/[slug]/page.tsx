import { notFound } from 'next/navigation';
import { getSite, searchListings, label, whatsappLink } from '@/lib/publicApi';
import PropertyCard from '@/components/site/PropertyCard';
import SearchForm from '@/components/site/SearchForm';
import EnquiryForm from '@/components/site/EnquiryForm';
import Assistant from '@/components/site/Assistant';
import { I } from '@/components/Icons';

export const revalidate = 30;

const TYPE_ICON: Record<string, string> = {
  apartment: 'building', house: 'home', townhouse: 'home', duplex: 'home', land: 'land',
  commercial: 'briefcase', office: 'briefcase', warehouse: 'building',
};
const SERVICE_LABEL: Record<string, string> = {
  buy: 'Homes for sale', rent: 'Rentals', land: 'Land', sell: 'Sell your property',
  management: 'Property management', valuation: 'Valuations',
};

export default async function AgencyHome({ params }: { params: { slug: string } }) {
  const site = await getSite(params.slug);
  if (!site) notFound();
  const { company: c, facets } = site;
  const base = `/s/${c.slug}`;

  // live listings for the two tabs — same published-only search the listings page uses
  const [rentRes, buyRes] = await Promise.all([
    facets.purposes.rent ? searchListings(params.slug, 'purpose=rent&per=8&availability=open') : Promise.resolve(null),
    facets.purposes.buy ? searchListings(params.slug, 'purpose=buy&per=8&availability=open') : Promise.resolve(null),
  ]);
  const rent = rentRes?.items ?? [];
  const buy = buyRes?.items ?? [];
  const defaultRent = rent.length >= buy.length;

  const wa = whatsappLink(c.whatsapp, `Hello ${c.name}, I'd like help finding a property.`);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const vp = c.viewing_policy;
  const viewingDays = vp.days.length === 7 ? 'every day' : vp.days.map((d) => days[d]).join(', ');
  const priced = [...rent, ...buy].map((p) => p.price).filter((n) => n > 0);
  const fromPrice = priced.length ? Math.min(...priced) : null;

  // only real, derived numbers — never invented social proof
  const stats: [string, string][] = [
    ['Listings available', String(facets.total)] as [string, string],
    ['Areas covered', String(facets.locations.length)] as [string, string],
    ...(facets.purposes.rent ? [['To rent', String(facets.purposes.rent)] as [string, string]] : []),
    ...(facets.purposes.buy ? [['For sale', String(facets.purposes.buy)] as [string, string]] : []),
  ].slice(0, 4);

  return (
    <>
      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="s-hero-2">
        <div className="s-wrap">
          <span className="s-kicker"><I name="pin" size={14} /> {c.address || 'Ghana'}</span>
          <h1>{c.tagline || 'Find a home you will actually want to live in.'}</h1>
          <p className="s-lead">
            {facets.total
              ? `Browse ${facets.total} current listing${facets.total === 1 ? '' : 's'} from ${c.name}, request a viewing in a few taps, and hear back from a real agent — not a call centre.`
              : `Tell ${c.name} what you are looking for and an agent will help you find it.`}
          </p>
          <div className="s-cta-row">
            <a className="s-btn s-btn-primary" href={`${base}/properties`}><I name="search" size={18} /> Browse listings</a>
            <a className="s-btn s-btn-ghost" href="#contact">Talk to an agent</a>
          </div>
          <SearchForm slug={c.slug} facets={facets} services={c.services} />
        </div>
      </section>

      {/* ── Real numbers, no invented social proof ───────────── */}
      {facets.total > 0 && (
        <section className="s-wrap" aria-label="At a glance">
          <dl className="s-stats">
            {stats.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
          </dl>
        </section>
      )}

      {/* ── Tabbed listings (works without JavaScript) ───────── */}
      {(rent.length > 0 || buy.length > 0) && (
        <section className="s-section" aria-labelledby="explore-h">
          <div className="s-wrap">
            <div className="s-section-head">
              <div>
                <h2 id="explore-h">Available now</h2>
                <p>Published and kept up to date by the {c.name} team.</p>
              </div>
              <a className="s-btn s-btn-ghost s-btn-sm" href={`${base}/properties`}>See all {facets.total} <I name="arrowRight" size={16} /></a>
            </div>

            <div className="s-tabs">
              <input type="radio" name="explore" id="tab-rent" defaultChecked={defaultRent} disabled={!rent.length} />
              <label htmlFor="tab-rent" className={!rent.length ? 's-sr' : undefined}><I name="key2" size={16} /> To rent{rent.length ? ` (${facets.purposes.rent})` : ''}</label>
              <input type="radio" name="explore" id="tab-buy" defaultChecked={!defaultRent} disabled={!buy.length} />
              <label htmlFor="tab-buy" className={!buy.length ? 's-sr' : undefined}><I name="home" size={16} /> For sale{buy.length ? ` (${facets.purposes.buy})` : ''}</label>

              <div className="s-panels">
                <div className="s-tabpanel s-panel-rent">
                  <div className="s-grid-4">{rent.slice(0, 8).map((p, i) => <PropertyCard key={p.id} slug={c.slug} p={p} priority={i < 4} overlay />)}</div>
                </div>
                <div className="s-tabpanel s-panel-buy">
                  <div className="s-grid-4">{buy.slice(0, 8).map((p, i) => <PropertyCard key={p.id} slug={c.slug} p={p} priority={i < 4} overlay />)}</div>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {facets.total === 0 && (
        <section className="s-section"><div className="s-wrap">
          <div className="s-empty">
            <h2>New listings are on the way</h2>
            <p>{c.name} has not published listings here yet. Send a message with what you need and they will let you know when something fits.</p>
            <a className="s-btn s-btn-primary" href="#contact">Tell us what you are looking for</a>
          </div>
        </div></section>
      )}

      {/* ── Browse by category ──────────────────────────────── */}
      {(facets.types.length > 0 || facets.locations.length > 0) && (
        <section className="s-section" style={{ paddingTop: 0 }} aria-labelledby="browse-h">
          <div className="s-wrap">
            <div className="s-section-head"><h2 id="browse-h">Browse by category</h2></div>
            <div className="s-tiles" style={{ marginBottom: 22 }}>
              {facets.types.slice(0, 4).map((t) => (
                <a key={t.key} className="s-tile" href={`${base}/properties?type=${t.key}`}>
                  <span className="s-tile-icon"><I name={TYPE_ICON[t.key] || 'building'} size={19} /></span>
                  <span><b>{label(t.key)}</b><br /><small>{t.count} listing{t.count === 1 ? '' : 's'}</small></span>
                </a>
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

      {/* ── How it works ────────────────────────────────────── */}
      <section className="s-section" style={{ paddingTop: 0 }} aria-labelledby="how-h">
        <div className="s-wrap">
          <div className="s-section-head"><div><h2 id="how-h">How it works</h2><p>Three steps, no account needed to start.</p></div></div>
          <div className="s-steps">
            <div className="s-step">
              <h3>Find a place</h3>
              <p>Filter by area, budget, bedrooms and the things that matter here — backup power, water storage, parking. Every listing is one the agency has published.</p>
            </div>
            <div className="s-step">
              <h3>Request a viewing</h3>
              <p>Pick a time from {c.name}&apos;s own schedule ({viewingDays}, {vp.start}–{vp.end}). It stays &ldquo;awaiting confirmation&rdquo; until an agent confirms it, so you are never told something is booked when it is not.</p>
            </div>
            <div className="s-step">
              <h3>Track everything</h3>
              <p>Use your reference to see replies, viewing status and application progress. No account needed, though you can sign in to keep it all in one place.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── What the agency does + honest trust points ──────── */}
      <section className="s-section" style={{ paddingTop: 0 }} aria-labelledby="about-h">
        <div className="s-wrap">
          <div className="s-feature">
            <div>
              <div className="s-eyebrow">About us</div>
              <h3 id="about-h">{c.name}</h3>
              <p className="s-prose">{c.about || `${c.name} is a real estate agency helping people buy, rent and invest in property.`}</p>
              {c.services.length > 0 && (
                <div className="s-chips" style={{ marginTop: 20 }}>
                  {c.services.map((sv) => <span key={sv} className="s-chip" style={{ cursor: 'default' }}>{SERVICE_LABEL[sv] || label(sv)}</span>)}
                </div>
              )}
            </div>
            <ul className="s-trust" aria-label="How we work">
              <li><span className="s-tile-icon"><I name="shield" size={19} /></span><div><b>Listings managed by our team</b><p>Every listing is approved by {c.name} staff, and each page shows when availability was last checked.</p></div></li>
              <li><span className="s-tile-icon"><I name="calendar" size={19} /></span><div><b>Viewings confirmed by a person</b><p>An agent confirms every viewing before it is booked, and tells you if a time will not work.</p></div></li>
              <li><span className="s-tile-icon"><I name="user" size={19} /></span><div><b>Your details stay with us</b><p>Enquiries go only to {c.name}. We contact you about your request, and nothing else.</p></div></li>
            </ul>
          </div>
        </div>
      </section>

      {/* ── Contact ─────────────────────────────────────────── */}
      <section className="s-section" id="contact" style={{ paddingTop: 0 }} aria-labelledby="contact-h">
        <div className="s-wrap s-split">
          <div className="s-panel">
            <h2 id="contact-h" style={{ fontSize: 24, marginBottom: 6 }}>Tell us what you are looking for</h2>
            <p className="s-hint" style={{ marginBottom: 18, fontSize: 15 }}>Area, budget, number of bedrooms, move-in date — an agent will reply.</p>
            <EnquiryForm slug={c.slug} companyName={c.name} />
          </div>
          <div className="s-panel">
            <h3 style={{ fontSize: 17, marginBottom: 8 }}>Contact {c.name}</h3>
            <div className="s-contact-list">
              {c.contact_phone && <a href={`tel:${c.contact_phone}`}><I name="phone" size={18} /> {c.contact_phone}</a>}
              {wa && <a href={wa} target="_blank" rel="noopener noreferrer"><I name="chat" size={18} /> Chat on WhatsApp</a>}
              {c.contact_email && <a href={`mailto:${c.contact_email}`}><I name="mail" size={18} /> {c.contact_email}</a>}
              {c.address && <div><I name="pin" size={18} /> {c.address}</div>}
              {c.office_hours && <div><I name="clock" size={18} /> {c.office_hours}</div>}
            </div>
            {fromPrice != null && (
              <p className="s-hint" style={{ marginTop: 16 }}>
                Listings currently start from GHS {fromPrice.toLocaleString('en-GH', { maximumFractionDigits: 0 })}.
              </p>
            )}
          </div>
        </div>
      </section>

      {/* ── Closing band ────────────────────────────────────── */}
      <section className="s-section" style={{ paddingTop: 0 }}>
        <div className="s-wrap">
          <div className="s-band">
            <h2>Ready to find your next home?</h2>
            <p>Browse what {c.name} has available today, or send them a message and let an agent do the looking for you.</p>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
              <a className="s-btn s-btn-primary" href={`${base}/properties`}>Browse listings</a>
              <a className="s-btn s-btn-ghost" href={`${base}/track`}>Track a request</a>
            </div>
          </div>
        </div>
      </section>

      <Assistant slug={c.slug} companyName={c.name} />
    </>
  );
}
