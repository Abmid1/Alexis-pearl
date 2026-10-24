/**
 * Data access for the public agency website.
 * Server components call the backend directly (SSR → search-engine friendly).
 * The URL always contains the company slug, so Next's fetch cache can never mix
 * one agency's data with another's. Only public endpoints are used here.
 */

export const API_BASE = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';
export const PUBLIC_API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

export type Availability = { code: string; label: string; can_enquire: boolean; can_book_viewing: boolean };
export type PublicProperty = {
  id: string; title: string; purpose: 'rent' | 'buy'; listing_type: string; property_type: string | null;
  location: string | null; neighbourhood: string | null; city: string | null; price: number; currency: 'GHS';
  rent_period: 'month' | 'year' | null; bedrooms: number | null; bathrooms: number | null; furnishing: string | null;
  images: string[]; availability: Availability; featured: boolean; published_at: string | null;
  description?: string | null; region?: string | null; size_sqm?: number | null; amenities?: string[];
  advance_months?: number | null; public_fees?: string | null; availability_confirmed_at?: string | null;
  map?: { lat: number; lng: number } | null;
};
export type PublicCompany = {
  slug: string; name: string; logo_url: string | null; brand_color: string; tagline: string | null; about: string | null;
  contact_phone: string | null; contact_email: string | null; whatsapp: string | null; address: string | null; office_hours: string | null;
  socials: Record<string, string>; services: string[];
  viewing_policy: { days: number[]; start: string; end: string; slot_minutes: number; min_notice_hours: number; cancel_cutoff_hours: number };
};
export type Facets = {
  total: number; purposes: Record<string, number>;
  types: { key: string; count: number }[]; locations: { name: string; count: number }[]; amenities: { key: string; count: number }[];
};

async function get<T>(path: string, revalidate = 30): Promise<T | null> {
  try {
    const r = await fetch(`${API_BASE}${path}`, { next: { revalidate } });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`API ${r.status}`);
    return (await r.json()) as T;
  } catch (e) {
    console.error('public api', path, (e as Error).message);
    throw e;
  }
}

const enc = encodeURIComponent;
export const getSite = (slug: string) => get<{ company: PublicCompany; facets: Facets; featured: PublicProperty[] }>(`/api/public/${enc(slug)}`);
export const searchListings = (slug: string, qs: string) =>
  get<{ items: PublicProperty[]; total: number; page: number; pages: number; per: number; filters: any }>(`/api/public/${enc(slug)}/properties?${qs}`);
export const getListing = (slug: string, id: string) =>
  get<{ property: PublicProperty; related: PublicProperty[] }>(`/api/public/${enc(slug)}/properties/${enc(id)}`);
export const getSitemap = (slug: string) => get<{ items: { id: string; title: string; updated_at: string }[] }>(`/api/public/${enc(slug)}/sitemap`, 300);

/* ── formatting + helpers shared by server and client components ── */

export const fmtPrice = (p: Pick<PublicProperty, 'price' | 'rent_period'>) =>
  `GHS ${Number(p.price || 0).toLocaleString('en-GH', { maximumFractionDigits: 0 })}${p.rent_period ? ` / ${p.rent_period}` : ''}`;

export const label = (k?: string | null) => (k ? k.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : '');

export const placeLine = (p: PublicProperty) => [p.neighbourhood, p.city].filter(Boolean).join(', ') || p.location || '';

export function slugify(s: string) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 70) || 'property';
}

/** SEO-friendly property path: /s/<slug>/property/<title-slug>-<uuid> */
export const propertyPath = (slug: string, p: { id: string; title: string }) => `/s/${slug}/property/${slugify(p.title)}-${p.id}`;

export const idFromRef = (ref: string) =>
  /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(ref || '')?.[1] || null;

/** Readable text colour for a brand colour (WCAG relative luminance). */
export function onColor(hex: string) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return '#FFFFFF';
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return (1.05 / (L + 0.05)) >= ((L + 0.05) / 0.05) ? '#FFFFFF' : '#17161C';
}

export const whatsappLink = (num?: string | null, text?: string) =>
  num ? `https://wa.me/${num.replace(/\D/g, '')}${text ? `?text=${encodeURIComponent(text)}` : ''}` : null;
