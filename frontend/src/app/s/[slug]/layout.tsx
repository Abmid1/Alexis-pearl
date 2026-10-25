import './site.css';
import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';
import { Inter } from 'next/font/google';
import { getSite, onColor, whatsappLink } from '@/lib/publicApi';
import { I } from '@/components/Icons';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

// The public site allows pinch-zoom (the workspace layout disables it).
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#FAF9F7' };

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const site = await getSite(params.slug).catch(() => null);
  if (!site) return { title: 'Agency not found', robots: { index: false } };
  const c = site.company;
  const description = c.tagline || c.about?.slice(0, 160) || `Homes and property listings from ${c.name}.`;
  return {
    title: { default: `${c.name} — Property listings`, template: `%s · ${c.name}` },
    description,
    openGraph: { siteName: c.name, type: 'website', title: c.name, description, images: c.logo_url ? [c.logo_url] : undefined },
    icons: c.logo_url ? { icon: c.logo_url } : undefined,
    manifest: null,
  };
}

const SOCIAL_LABEL: Record<string, string> = { instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok', x: 'X', linkedin: 'LinkedIn', youtube: 'YouTube', website: 'Website' };
const SOCIAL_ICON: Record<string, string> = { instagram: 'instagram', facebook: 'globe', tiktok: 'music', x: 'globe', linkedin: 'globe', youtube: 'globe', website: 'globe' };

export default async function SiteLayout({ children, params }: { children: React.ReactNode; params: { slug: string } }) {
  const site = await getSite(params.slug);
  if (!site) notFound();
  const c = site.company;
  const base = `/s/${c.slug}`;
  const accent = /^#[0-9a-f]{6}$/i.test(c.brand_color) ? c.brand_color : '#4038B8';
  const initials = c.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  const sells = c.services.includes('buy') || c.services.includes('land');
  const rents = c.services.includes('rent');
  const hasServices = c.services.some((x) => ['sell', 'valuation', 'management'].includes(x)) || rents;
  const nav = [
    sells && { href: `${base}/properties?purpose=buy`, label: 'Buy' },
    rents && { href: `${base}/properties?purpose=rent`, label: 'Rent' },
    { href: `${base}/properties`, label: 'All listings' },
    hasServices && { href: `${base}/services`, label: 'Services' },
    { href: `${base}/saved`, label: 'Saved' },
    { href: `${base}/account`, label: 'Account' },
  ].filter(Boolean) as { href: string; label: string }[];
  const wa = whatsappLink(c.whatsapp, `Hello ${c.name}, I found you online.`);
  const socials = Object.entries(c.socials || {}).filter(([, u]) => /^https:\/\//.test(u));

  return (
    <div className={`site ${inter.variable}`} style={{ ['--s-accent' as any]: accent, ['--s-on-accent' as any]: onColor(accent) }}>
      <a className="s-skip" href="#main">Skip to content</a>

      {/* utility bar: how to reach a person, before anything else */}
      <div className="s-util">
        <div className="s-wrap s-util-in">
          {c.contact_phone && <a href={`tel:${c.contact_phone}`}><I name="phone" size={14} /> {c.contact_phone}</a>}
          {c.contact_phone && wa && <span className="s-util-sep">·</span>}
          {wa && <a href={wa} target="_blank" rel="noopener noreferrer"><I name="chat" size={14} /> WhatsApp</a>}
          {(c.contact_phone || wa) && c.office_hours && <span className="s-util-sep">·</span>}
          {c.office_hours && <span style={{ color: '#BDB9C4' }}>{c.office_hours}</span>}
          <span className="s-util-sep">·</span>
          <a href={`${base}/track`}>Track a request</a>
        </div>
      </div>

      <header className="s-header">
        <div className="s-wrap s-header-in">
          <a href={base} className="s-brand" aria-label={`${c.name} home`}>
            {c.logo_url ? <img src={c.logo_url} alt="" /> : <span className="s-brand-mark" aria-hidden="true">{initials}</span>}
            <span>{c.name}</span>
          </a>
          <nav className="s-nav" aria-label="Main">
            {nav.map((n) => <a key={n.href} href={n.href}>{n.label}</a>)}
            <a className="s-btn s-btn-primary s-btn-sm s-header-cta" href={`${base}/properties`}>Find a home</a>
          </nav>
          <details className="s-menu">
            <summary aria-label="Menu"><span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><I name="menu" size={18} /> Menu</span></summary>
            <nav className="s-menu-panel" aria-label="Main">
              {nav.map((n) => <a key={n.href} href={n.href}>{n.label}</a>)}
              <a href={`${base}/track`}>Track a request</a>
            </nav>
          </details>
        </div>
      </header>

      <main id="main">{children}</main>

      <footer className="s-footer">
        <div className="s-wrap">
          <div className="s-footer-cols">
            <div>
              <div className="s-brand" style={{ marginBottom: 10 }}>
                {c.logo_url ? <img src={c.logo_url} alt="" /> : <span className="s-brand-mark" aria-hidden="true">{initials}</span>}
                <span>{c.name}</span>
              </div>
              {c.tagline && <p>{c.tagline}</p>}
              {socials.length > 0 && (
                <div className="s-social">
                  {socials.map(([k, u]) => (
                    <a key={k} href={u} target="_blank" rel="noopener noreferrer" aria-label={SOCIAL_LABEL[k] || k} title={SOCIAL_LABEL[k] || k}>
                      <I name={SOCIAL_ICON[k] || 'globe'} size={17} />
                    </a>
                  ))}
                </div>
              )}
            </div>

            <div>
              <h3>Properties</h3>
              <ul>
                {sells && <li><a href={`${base}/properties?purpose=buy`}>Homes for sale</a></li>}
                {rents && <li><a href={`${base}/properties?purpose=rent`}>Homes to rent</a></li>}
                <li><a href={`${base}/properties`}>All listings</a></li>
                <li><a href={`${base}/saved`}>Saved homes</a></li>
              </ul>
            </div>

            <div>
              <h3>{hasServices ? 'Services' : 'Your account'}</h3>
              <ul>
                {hasServices && <li><a href={`${base}/services`}>Owner &amp; landlord services</a></li>}
                <li><a href={`${base}/account`}>My account</a></li>
                <li><a href={`${base}/track`}>Track a request</a></li>
                <li><a href={`${base}#contact`}>Send an enquiry</a></li>
              </ul>
            </div>

            <div>
              <h3>Contact</h3>
              <ul>
                {c.contact_phone && <li><a href={`tel:${c.contact_phone}`}>{c.contact_phone}</a></li>}
                {wa && <li><a href={wa} target="_blank" rel="noopener noreferrer">WhatsApp</a></li>}
                {c.contact_email && <li><a href={`mailto:${c.contact_email}`}>{c.contact_email}</a></li>}
                {c.address && <li>{c.address}</li>}
                {c.office_hours && <li>{c.office_hours}</li>}
              </ul>
            </div>
          </div>

          <div className="s-footer-base">
            <span>© {new Date().getFullYear()} {c.name}. Listing details are provided by the agency.</span>
            <span>Powered by Bilt Africa</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
