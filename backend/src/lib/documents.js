/**
 * Document requests: a customer asks the agency for an official document
 * (payment statement, allocation letter, permission to build…).
 *
 * The catalogue is per agency and fully editable — Bilt Africa does not decide
 * what documents exist, what they cost, or how long they take. Issuing a document
 * is a manual staff action; nothing here certifies or verifies anything.
 */

export const DOC_CATEGORIES = ['financial', 'legal', 'construction', 'other'];

export const DOC_STATUS = {
  requested: { label: 'Requested', next: 'The agency has your request and will start work on it.' },
  in_progress: { label: 'Being prepared', next: 'Someone is preparing this document.' },
  ready: { label: 'Ready', next: 'Your document is ready — open it below. Contact the agency if you need a stamped original.' },
  declined: { label: 'Not issued', next: 'The agency could not issue this document. See their message.' },
  cancelled: { label: 'Cancelled', next: 'You cancelled this request.' },
};
export const DOC_OPEN = ['requested', 'in_progress'];

const TRANSITIONS = {
  requested: ['in_progress', 'ready', 'declined'],
  in_progress: ['ready', 'declined'],
  ready: ['in_progress'],
  declined: ['in_progress'],
  cancelled: [],
};
export const canMoveDoc = (from, to) => (TRANSITIONS[from] || []).includes(to);

/** Validate an agency's catalogue (staff settings). Returns { catalogue, errors }. */
export function validateCatalogue(input) {
  const errors = [];
  if (!Array.isArray(input)) return { catalogue: null, errors: ['Documents must be a list'] };
  if (input.length > 40) errors.push('At most 40 document types');
  const keys = new Set();
  const catalogue = input.slice(0, 40).map((d, i) => {
    const label = String(d?.label || '').trim().slice(0, 120);
    if (!label) errors.push(`Document ${i + 1} needs a name`);
    let key = String(d?.key || label).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || `doc${i + 1}`;
    while (keys.has(key)) key = `${key}_${i + 1}`;
    keys.add(key);
    const fee = Number(d?.fee ?? 0);
    if (!Number.isFinite(fee) || fee < 0 || fee > 1e9) errors.push(`"${label}" has an invalid fee`);
    const days = d?.turnaround_days == null || d.turnaround_days === '' ? null : Math.round(Number(d.turnaround_days));
    if (days != null && (!Number.isFinite(days) || days < 0 || days > 365)) errors.push(`"${label}" has an invalid turnaround`);
    return {
      key, label,
      category: DOC_CATEGORIES.includes(d?.category) ? d.category : 'other',
      description: String(d?.description || '').trim().slice(0, 400),
      turnaround_days: days,
      fee: Number.isFinite(fee) && fee >= 0 ? fee : 0,
      enabled: d?.enabled !== false,
    };
  });
  return { catalogue, errors };
}

/** Catalogue entries a customer may request. */
export const publicCatalogue = (company) =>
  (Array.isArray(company?.document_catalogue) ? company.document_catalogue : []).filter((d) => d.enabled !== false);

export function toPublicDocumentRequest(r, { property, files } = {}) {
  const s = DOC_STATUS[r.status] || DOC_STATUS.requested;
  return {
    id: r.id, reference: r.reference,
    document: r.doc_label, category: r.category || null,
    fee: Number(r.fee) || 0, currency: 'GHS', turnaround_days: r.turnaround_days ?? null,
    status: r.status, status_label: s.label, next_step: s.next,
    customer_note: r.customer_note || null,
    customer_message: r.customer_message || null,
    property: property ? { id: property.id, title: property.title } : null,
    files: (files || []).map((f) => ({ id: f.id, file_name: f.file_name, label: f.label, size_bytes: f.size_bytes, created_at: f.created_at })),
    can_cancel: DOC_OPEN.includes(r.status),
    created_at: r.created_at, updated_at: r.updated_at,
  };
}
