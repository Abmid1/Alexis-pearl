import { db } from '../db.js';
import { PROPERTY_TYPES, FURNISHING, toPublicProperty } from './listing.js';

/**
 * Public property search for one company — used by the website AND the AI assistant,
 * so both see exactly the same published-only data.
 */

const PUBLIC_COLUMNS = 'id,title,ptype,property_type,location,neighbourhood,city,region,price,rent_period,bedrooms,bathrooms,size_sqm,furnishing,amenities,images,availability,availability_confirmed_at,featured,published_at,created_at,listing_status,archived_at';
const DETAIL_COLUMNS = `${PUBLIC_COLUMNS},description,advance_months,public_fees,show_exact_location,lat,lng`;

export const SORTS = { newest: ['published_at', false], price_asc: ['price', true], price_desc: ['price', false] };

/** Strip characters that carry meaning inside PostgREST filter strings. */
export const safeText = (s, n = 60) => String(s ?? '').replace(/[,()*%\\:"'.]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
const num = (v) => { if (v == null || v === '') return null; const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : null; };

/** Parse + whitelist query-string filters. Unknown values are dropped, not errors. */
export function parseFilters(q = {}) {
  const f = {};
  if (q.purpose === 'rent' || q.purpose === 'buy') f.purpose = q.purpose;
  if (PROPERTY_TYPES.includes(q.type)) f.type = q.type;
  const text = safeText(q.q || q.location);
  if (text) f.q = text;
  const min = num(q.min_price); const max = num(q.max_price);
  if (min != null) f.min_price = min;
  if (max != null) f.max_price = max;
  const beds = num(q.beds); const baths = num(q.baths);
  if (beds != null) f.beds = Math.min(20, Math.floor(beds));
  if (baths != null) f.baths = Math.min(20, Math.floor(baths));
  if (FURNISHING.includes(q.furnishing)) f.furnishing = q.furnishing;
  const am = Array.isArray(q.amenities) ? q.amenities : String(q.amenities || '').split(',');
  const amenities = am.map((a) => String(a).trim().toLowerCase().replace(/[^a-z_]/g, '')).filter(Boolean).slice(0, 8);
  if (amenities.length) f.amenities = amenities;
  f.availability = q.availability === 'all' ? 'all' : q.availability === 'available' ? 'available' : 'open';
  f.sort = SORTS[q.sort] ? q.sort : 'newest';
  f.page = Math.max(1, Math.min(500, Math.floor(num(q.page) || 1)));
  f.per = Math.max(1, Math.min(48, Math.floor(num(q.per) || 12)));
  return f;
}

/** Base query: this company, published, not archived. Nothing else can ever be returned. */
function publicBase(companyId, columns, opts) {
  return db.from('properties').select(columns, opts)
    .eq('company_id', companyId).eq('listing_status', 'published').is('archived_at', null);
}

export async function searchProperties(companyId, f) {
  let q = publicBase(companyId, PUBLIC_COLUMNS, { count: 'exact' });
  if (f.purpose === 'rent') q = q.eq('ptype', 'rent');
  if (f.purpose === 'buy') q = q.neq('ptype', 'rent');
  if (f.type === 'land') q = q.or('property_type.eq.land,ptype.eq.land');
  else if (f.type) q = q.eq('property_type', f.type);
  if (f.q) q = q.or(['title', 'location', 'neighbourhood', 'city'].map((c) => `${c}.ilike.%${f.q}%`).join(','));
  if (f.min_price != null) q = q.gte('price', f.min_price);
  if (f.max_price != null) q = q.lte('price', f.max_price);
  if (f.beds != null) q = q.gte('bedrooms', f.beds);
  if (f.baths != null) q = q.gte('bathrooms', f.baths);
  if (f.furnishing) q = q.eq('furnishing', f.furnishing);
  if (f.amenities?.length) q = q.contains('amenities', f.amenities);
  if (f.availability === 'available') q = q.eq('availability', 'available');
  else if (f.availability === 'open') q = q.in('availability', ['available', 'reserved', 'under_offer', 'unavailable']);
  const [col, asc] = SORTS[f.sort] || SORTS.newest;
  q = q.order('featured', { ascending: false }).order(col, { ascending: asc, nullsFirst: false }).order('id');
  const from = (f.page - 1) * f.per;
  const { data, count, error } = await q.range(from, from + f.per - 1);
  if (error) throw new Error(error.message);
  return {
    items: (data || []).map((p) => toPublicProperty(p)),
    total: count ?? (data || []).length,
    page: f.page, per: f.per,
    pages: Math.max(1, Math.ceil((count ?? 0) / f.per)),
  };
}

/** One published property (full public detail) or null. */
export async function getPublicProperty(companyId, id) {
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data } = await publicBase(companyId, DETAIL_COLUMNS).eq('id', id).maybeSingle();
  return data || null;
}

/** Same-company listings similar to `p` (purpose, then type/area), excluding sold/rented. */
export async function relatedProperties(companyId, p, limit = 3) {
  let q = publicBase(companyId, PUBLIC_COLUMNS).neq('id', p.id).in('availability', ['available', 'reserved', 'under_offer']);
  q = p.ptype === 'rent' ? q.eq('ptype', 'rent') : q.neq('ptype', 'rent');
  const { data } = await q.order('published_at', { ascending: false }).limit(24);
  const score = (x) => (x.property_type && x.property_type === p.property_type ? 2 : 0)
    + (x.neighbourhood && x.neighbourhood === p.neighbourhood ? 2 : 0) + (x.city && x.city === p.city ? 1 : 0);
  return (data || []).sort((a, b) => score(b) - score(a)).slice(0, limit).map((x) => toPublicProperty(x));
}

/** Facets for the homepage + filters: categories, locations, price range. */
export async function facets(companyId) {
  const { data } = await publicBase(companyId, 'ptype,property_type,neighbourhood,city,location,price,amenities,availability')
    .in('availability', ['available', 'reserved', 'under_offer', 'unavailable']).limit(2000);
  const rows = data || [];
  const count = (key) => rows.reduce((m, r) => { const k = key(r); if (k) m[k] = (m[k] || 0) + 1; return m; }, {});
  const types = count((r) => r.property_type || (r.ptype === 'land' ? 'land' : null));
  const purposes = count((r) => (r.ptype === 'rent' ? 'rent' : 'buy'));
  const locations = count((r) => r.neighbourhood || r.city || null);
  const amenities = {};
  rows.forEach((r) => (r.amenities || []).forEach((a) => { amenities[a] = (amenities[a] || 0) + 1; }));
  return {
    total: rows.length,
    purposes,
    types: Object.entries(types).sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ key: k, count: n })),
    locations: Object.entries(locations).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([k, n]) => ({ name: k, count: n })),
    amenities: Object.entries(amenities).sort((a, b) => b[1] - a[1]).slice(0, 20).map(([k, n]) => ({ key: k, count: n })),
  };
}

/** Lightweight list for the sitemap. */
export async function sitemapEntries(companyId) {
  const { data } = await publicBase(companyId, 'id,title,updated_at,published_at').order('published_at', { ascending: false }).limit(5000);
  return (data || []).map((p) => ({ id: p.id, title: p.title, updated_at: p.updated_at || p.published_at }));
}
