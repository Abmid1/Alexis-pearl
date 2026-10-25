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

export default async function SiteLayout({ children, params }: { children: React.ReactNode; params: { slug: string } }) {
  const site = await getSite(params.slug);
  if (!site) notFound();
  const c = site.company;
  const base = `/s/${c.slug}`;
  const accent = /^#[0-9a-f]{6}$/i.test(c.brand_color) ? c.brand_color : '#4038B8';
  const initials = c.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  const sells = c.services.includes('buy') || c.services.includes('land');
  const rents = c.services.includes('rent');
  const nav = [
    sells && { href: `${base}/properties?purpose=buy`, label: 'Buy' },
    rents && { href: `${base}/properties?purpose=rent`, label: 'Rent' },
    { href: `${base}/properties`, label: 'All listings' },
    { href: `${base}/saved`, label: 'Saved' },
    { href: `${base}/track`, label: 'My requests' },
    { href: `${base}/account`, label: 'Account' },
    { href: `${base}#contact`, label: 'Contact' },
  ].filter(Boolean) as { href: string; label: string }[];
  const wa = whatsappLink(c.whatsapp, `Hello ${c.name}, I found you online.`);

  return (
    <div className={`site ${inter.variable}`} style={{ ['--s-accent' as any]: accent, ['--s-on-accent' as any]: onColor(accent) }}>
      <a className="s-skip" href="#main">Skip to content</a>
      <header className="s-header">
        <div className="s-wrap s-header-in">
          <a href={base} className="s-brand" aria-label={`${c.name} home`}>
            {c.logo_url ? <img src={c.logo_url} alt="" /> : <span className="s-brand-mark" aria-hidden="true">{initials}</span>}
            <span>{c.name}</span>
          </a>
          <nav className="s-nav" aria-label="Main">
            {nav.map((n) => <a key={n.href} href={n.href}>{n.label}</a>)}
          </nav>
          <details className="s-menu">
            <summary aria-label="Menu"><span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><I name="menu" size={18} /> Menu</span></summary>
            <nav className="s-menu-panel" aria-label="Main">
              {nav.map((n) => <a key={n.href} href={n.href}>{n.label}</a>)}
            </nav>
          </details>
        </div>
      </header>

      <main id="main">{children}</main>

      <footer className="s-footer">
        <div className="s-wrap">
          <div className="s-footer-grid">
            <div>
              <h3>{c.name}</h3>
              {c.tagline && <p>{c.tagline}</p>}
              {c.address && <p style={{ marginTop: 8 }}>{c.address}</p>}
              {c.office_hours && <p>{c.office_hours}</p>}
            </div>
            <div>
              <h3>Contact</h3>
              <ul>
                {c.contact_phone && <li><a href={`tel:${c.contact_phone}`}>{c.contact_phone}</a></li>}
                {wa && <li><a href={wa} target="_blank" rel="noopener noreferrer">WhatsApp</a></li>}
                {c.contact_email && <li><a href={`mailto:${c.contact_email}`}>{c.contact_email}</a></li>}
              </ul>
            </div>
            <div>
              <h3>Follow</h3>
              <ul>
                {Object.entries(c.socials || {}).filter(([, u]) => /^https:\/\//.test(u)).map(([k, u]) => (
                  <li key={k}><a href={u} target="_blank" rel="noopener noreferrer">{SOCIAL_LABEL[k] || k}</a></li>
                ))}
                {!Object.keys(c.socials || {}).length && <li>—</li>}
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
