/**
 * Landlord and owner services: list a property with the agency, request a
 * valuation, ask about property management, or ask for relocation help.
 *
 * Each kind has its own short form. A submission creates a normal CRM lead
 * (through the usual enquiry pipeline) so staff work it in the tools they have.
 * Staff can turn a "list my property" submission into a DRAFT listing — never a
 * published one, and never a verified claim about ownership or title.
 */

const T = (v, n) => String(v ?? '').trim().slice(0, n);

export const SERVICE_KINDS = {
  list_property: {
    label: 'List my property',
    blurb: 'Rent out or sell your property through the agency.',
    service: 'sell',
    fields: [
      { key: 'purpose', label: 'Do you want to rent it out or sell it?', type: 'select', options: ['Rent out', 'Sell'], required: true },
      { key: 'property_type', label: 'Property type', type: 'text', required: true },
      { key: 'location', label: 'Where is it?', type: 'text', required: true },
      { key: 'bedrooms', label: 'Bedrooms', type: 'number' },
      { key: 'bathrooms', label: 'Bathrooms', type: 'number' },
      { key: 'asking_price', label: 'Asking price (GHS)', type: 'number' },
      { key: 'description', label: 'Tell us about the property', type: 'textarea' },
    ],
  },
  valuation: {
    label: 'Property valuation',
    blurb: 'Ask the agency what your property is worth.',
    service: 'valuation',
    fields: [
      { key: 'property_type', label: 'Property type', type: 'text', required: true },
      { key: 'location', label: 'Where is it?', type: 'text', required: true },
      { key: 'size_sqm', label: 'Size (m²)', type: 'number' },
      { key: 'reason', label: 'What is the valuation for?', type: 'text' },
      { key: 'description', label: 'Anything else?', type: 'textarea' },
    ],
  },
  management: {
    label: 'Property management',
    blurb: 'Have the agency manage your property and tenants.',
    service: 'management',
    fields: [
      { key: 'property_type', label: 'Property type', type: 'text', required: true },
      { key: 'location', label: 'Where is it?', type: 'text', required: true },
      { key: 'units', label: 'How many units?', type: 'number' },
      { key: 'currently_tenanted', label: 'Is it currently tenanted?', type: 'select', options: ['Yes', 'No', 'Partly'] },
      { key: 'description', label: 'What do you need help with?', type: 'textarea' },
    ],
  },
  relocation: {
    label: 'Relocation help',
    blurb: 'Moving to the area and need help finding a home.',
    service: 'rent',
    fields: [
      { key: 'moving_from', label: 'Moving from', type: 'text' },
      { key: 'moving_to', label: 'Preferred area', type: 'text', required: true },
      { key: 'move_date', label: 'When do you want to move?', type: 'date' },
      { key: 'budget', label: 'Budget (GHS)', type: 'number' },
      { key: 'description', label: 'What do you need?', type: 'textarea' },
    ],
  },
};

export const SERVICE_STATUS = {
  new: { label: 'Received', next: 'The agency has your request and will be in touch.' },
  in_progress: { label: 'In progress', next: 'An agent is working on this.' },
  closed: { label: 'Closed', next: 'This request is closed. Contact the agency if you need anything else.' },
};

/** Which service kinds this agency offers, based on its configured services. */
export function enabledKinds(company) {
  const services = Array.isArray(company?.services) ? company.services : [];
  return Object.entries(SERVICE_KINDS)
    .filter(([, def]) => services.includes(def.service))
    .map(([key, def]) => ({ key, label: def.label, blurb: def.blurb, fields: def.fields }));
}

/** Validate a submission's details against that kind's fields. Unknown keys are dropped. */
export function validateDetails(kind, input = {}) {
  const def = SERVICE_KINDS[kind];
  if (!def) return { details: null, errors: ['Unknown service'] };
  const errors = [];
  const details = {};
  for (const f of def.fields) {
    const raw = input?.[f.key];
    const empty = raw == null || String(raw).trim() === '';
    if (empty) { if (f.required) errors.push(`"${f.label}" is required`); continue; }
    const v = String(raw).trim();
    if (f.type === 'number') {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || n > 1e12) errors.push(`"${f.label}" must be a number`); else details[f.key] = n;
    } else if (f.type === 'date') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(new Date(v).getTime())) errors.push(`"${f.label}" must be a date`); else details[f.key] = v;
    } else if (f.type === 'select') {
      if (!(f.options || []).includes(v)) errors.push(`Choose an option for "${f.label}"`); else details[f.key] = v;
    } else {
      details[f.key] = T(v, f.type === 'textarea' ? 2000 : 300);
    }
  }
  return { details, errors };
}

/** Human-readable summary for the CRM message/inbox. */
export function summarise(kind, details) {
  const def = SERVICE_KINDS[kind];
  if (!def) return '';
  return def.fields.filter((f) => details[f.key] != null).map((f) => `${f.label}: ${details[f.key]}`).join('\n');
}

export function toPublicServiceRequest(r) {
  const s = SERVICE_STATUS[r.status] || SERVICE_STATUS.new;
  return {
    id: r.id, reference: r.reference, kind: r.kind,
    kind_label: SERVICE_KINDS[r.kind]?.label || r.kind,
    status: r.status, status_label: s.label, next_step: s.next,
    customer_message: r.customer_message || null,
    details: r.details || {},
    created_at: r.created_at, updated_at: r.updated_at,
  };
}

/** Fields to pre-fill a DRAFT listing when staff convert a landlord submission. */
export function toDraftListing(r) {
  const d = r.details || {};
  const rent = String(d.purpose || '').toLowerCase().startsWith('rent');
  return {
    title: `${d.property_type || 'Property'} · ${d.location || 'Location to confirm'}`.slice(0, 160),
    location: T(d.location, 200),
    property_type: null,                      // staff pick from the controlled list
    ptype: rent ? 'rent' : 'sale',
    rent_period: rent ? 'month' : null,
    price: Number(d.asking_price) || 0,
    bedrooms: Number.isFinite(Number(d.bedrooms)) ? Math.round(Number(d.bedrooms)) : null,
    bathrooms: Number.isFinite(Number(d.bathrooms)) ? Math.round(Number(d.bathrooms)) : null,
    description: T(d.description, 8000) || null,
    listing_status: 'draft',                  // never auto-published
  };
}
