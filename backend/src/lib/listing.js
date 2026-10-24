/**
 * Property listing rules shared by the staff workspace and the public site.
 *
 * Publication model (adapted to the existing schema):
 *   listing_status  draft → pending_approval → published   (rejected = sent back)
 *                   Unpublishing returns a listing to draft.
 *   archived_at     set = archived; hidden everywhere public, kept for records.
 *   availability    available | reserved | under_offer | unavailable | rented | sold
 *
 * Public visibility:  listing_status = 'published' AND archived_at IS NULL.
 * New enquiries/viewings: only when availability is available/reserved/under_offer
 *                         (rented/sold/unavailable listings stay visible but closed).
 */

export const PROPERTY_TYPES = ['apartment', 'house', 'townhouse', 'duplex', 'compound_house', 'chamber_and_hall',
  'single_room', 'self_contained', 'land', 'commercial', 'office', 'warehouse'];
export const AVAILABILITY = ['available', 'reserved', 'under_offer', 'unavailable', 'rented', 'sold'];
export const FURNISHING = ['furnished', 'semi_furnished', 'unfurnished'];
export const PTYPES = ['sale', 'rent', 'land', 'development'];

/** Availabilities where a customer may still enquire or request a viewing. */
export const OPEN_FOR_ENQUIRY = ['available', 'reserved', 'under_offer'];
export const OPEN_FOR_VIEWING = ['available', 'under_offer'];

/** Amenity vocabulary for filters (free text is allowed on records; these are the common ones). */
export const COMMON_AMENITIES = ['backup_power', 'borehole', 'security', 'gated', 'parking', 'pool', 'gym',
  'air_conditioning', 'boys_quarters', 'garden', 'balcony', 'fitted_kitchen', 'wardrobes', 'cctv', 'elevator',
  'water_storage', 'internet', 'prepaid_meter'];

const str = (v, max) => (v == null || v === '' ? null : String(v).trim().slice(0, max));
const int = (v, lo, hi) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return undefined;
  const r = Math.round(n);
  return r < lo || r > hi ? undefined : r;
};
const oneOf = (v, list) => (v == null || v === '' ? null : list.includes(v) ? v : undefined);

/**
 * Validate + coerce staff-supplied listing fields. Returns { patch, errors }.
 * Only known fields pass through; anything else in the body is ignored.
 */
export function cleanListingInput(body = {}, { partial = false } = {}) {
  const errors = [];
  const patch = {};
  const set = (k, v, label) => {
    if (!(k in body)) return;
    if (v === undefined) errors.push(`Invalid ${label || k}`);
    else patch[k] = v;
  };

  set('title', str(body.title, 160));
  set('location', str(body.location, 200));
  set('city', str(body.city, 80));
  set('neighbourhood', str(body.neighbourhood, 80));
  set('region', str(body.region, 80));
  set('description', str(body.description, 8000));
  set('public_fees', str(body.public_fees, 1000), 'fees');
  set('ptype', oneOf(body.ptype, PTYPES), 'listing type');
  set('property_type', oneOf(body.property_type, PROPERTY_TYPES), 'property type');
  set('furnishing', oneOf(body.furnishing, FURNISHING));
  set('availability', oneOf(body.availability, AVAILABILITY));
  set('rent_period', oneOf(body.rent_period, ['month', 'year']), 'rent period');
  set('bedrooms', int(body.bedrooms, 0, 50));
  set('bathrooms', int(body.bathrooms, 0, 50));
  set('advance_months', int(body.advance_months, 0, 60), 'advance months');
  if ('price' in body) {
    const n = Number(body.price);
    if (!Number.isFinite(n) || n < 0 || n > 1e12) errors.push('Invalid price'); else patch.price = n;
  }
  if ('size_sqm' in body) {
    if (body.size_sqm == null || body.size_sqm === '') patch.size_sqm = null;
    else { const n = Number(body.size_sqm); if (!Number.isFinite(n) || n <= 0) errors.push('Invalid size'); else patch.size_sqm = n; }
  }
  for (const k of ['lat', 'lng']) {
    if (!(k in body)) continue;
    if (body[k] == null || body[k] === '') { patch[k] = null; continue; }
    const n = Number(body[k]);
    if (!Number.isFinite(n) || Math.abs(n) > 180) errors.push(`Invalid ${k}`); else patch[k] = n;
  }
  for (const k of ['featured', 'show_exact_location']) if (k in body) patch[k] = !!body[k];
  if ('amenities' in body) {
    const list = Array.isArray(body.amenities) ? body.amenities : String(body.amenities || '').split(',');
    patch.amenities = [...new Set(list.map((a) => String(a).trim().toLowerCase().replace(/\s+/g, '_')).filter(Boolean))].slice(0, 40);
  }
  if ('images' in body) {
    const list = Array.isArray(body.images) ? body.images : [];
    const urls = list.map((u) => String(u).trim()).filter((u) => /^https:\/\/[^\s"'<>]+$/i.test(u)).slice(0, 30);
    if (urls.length !== list.filter((u) => String(u).trim()).length) errors.push('Images must be https:// links');
    patch.images = urls;
  }
  if (!partial) {
    if (!patch.title) errors.push('title required');
    if (patch.price == null) errors.push('price required');
  }
  return { patch, errors };
}

/** Is this record visible on the public site? */
export function isPublic(p) {
  return !!p && p.listing_status === 'published' && !p.archived_at;
}

/** Purpose shown to customers: rent vs buy. */
export const purposeOf = (p) => (p.ptype === 'rent' ? 'rent' : 'buy');

/** Customer-facing availability label + whether actions are open. */
export function publicAvailability(p) {
  const labels = {
    available: 'Available', reserved: 'Reserved', under_offer: 'Under offer',
    unavailable: 'Temporarily unavailable', rented: 'Rented', sold: 'Sold',
  };
  return {
    code: p.availability || 'available',
    label: labels[p.availability] || 'Available',
    can_enquire: OPEN_FOR_ENQUIRY.includes(p.availability || 'available'),
    can_book_viewing: OPEN_FOR_VIEWING.includes(p.availability || 'available'),
  };
}

/**
 * The ONLY shape a property ever takes on public endpoints. Whitelist, not blacklist:
 * internal fields (managed flag, approval state, notes, units, buyers) never leave.
 */
export function toPublicProperty(p, { full = false } = {}) {
  const out = {
    id: p.id,
    title: p.title,
    purpose: purposeOf(p),
    listing_type: p.ptype,
    property_type: p.property_type || null,
    location: p.location || null,
    neighbourhood: p.neighbourhood || null,
    city: p.city || null,
    price: Number(p.price) || 0,
    currency: 'GHS',
    rent_period: p.ptype === 'rent' ? p.rent_period || 'month' : null,
    bedrooms: p.bedrooms ?? null,
    bathrooms: p.bathrooms ?? null,
    furnishing: p.furnishing || null,
    images: Array.isArray(p.images) ? p.images.filter((u) => typeof u === 'string' && /^https:\/\//i.test(u)) : [],
    availability: publicAvailability(p),
    featured: !!p.featured,
    published_at: p.published_at || p.created_at || null,
  };
  if (full) {
    Object.assign(out, {
      description: p.description || null,
      region: p.region || null,
      size_sqm: p.size_sqm != null ? Number(p.size_sqm) : null,
      amenities: Array.isArray(p.amenities) ? p.amenities : [],
      advance_months: p.advance_months ?? null,
      public_fees: p.public_fees || null,
      availability_confirmed_at: p.availability_confirmed_at || null,
      map: p.show_exact_location && p.lat != null && p.lng != null ? { lat: Number(p.lat), lng: Number(p.lng) } : null,
    });
  }
  return out;
}

/** URL-safe slug for SEO-friendly property URLs (id stays the real key). */
export function slugify(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '')
    .trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 80) || 'property';
}
