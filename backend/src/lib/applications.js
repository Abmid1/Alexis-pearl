import { db } from '../db.js';
import { sendMessage } from './integrations.js';

/**
 * Rental / purchase applications.
 * Questions are configured per agency (companies.application_form). Required
 * documents are not assumed — staff ask for specific documents per application.
 */

export const APP_STATUS = {
  submitted: { label: 'Submitted', next: 'The agency has your application and will review it.' },
  under_review: { label: 'Under review', next: 'An agent is reviewing your application. You\'ll be told if anything else is needed.' },
  info_requested: { label: 'More information needed', next: 'The agency needs something from you — see their message and upload any requested documents.' },
  approved: { label: 'Approved', next: 'Good news! The agency will contact you about next steps. Nothing is final until you sign an agreement.' },
  declined: { label: 'Not successful', next: 'The agency could not proceed with this application. You can still enquire about other properties.' },
  withdrawn: { label: 'Withdrawn', next: 'You withdrew this application.' },
};
export const OPEN_STATUSES = ['submitted', 'under_review', 'info_requested'];
export const CUSTOMER_UPLOAD_STATUSES = OPEN_STATUSES;

export const FIELD_TYPES = ['text', 'textarea', 'number', 'date', 'select', 'yesno'];

/** Validate an agency's question list (staff settings). Returns { form, errors }. */
export function validateForm(input) {
  const errors = [];
  if (!Array.isArray(input)) return { form: null, errors: ['Questions must be a list'] };
  if (input.length > 25) errors.push('At most 25 questions');
  const keys = new Set();
  const form = input.slice(0, 25).map((q, i) => {
    const label = String(q?.label || '').trim().slice(0, 200);
    if (!label) errors.push(`Question ${i + 1} needs a label`);
    let key = String(q?.key || label).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || `q${i + 1}`;
    while (keys.has(key)) key = `${key}_${i + 1}`;
    keys.add(key);
    const type = FIELD_TYPES.includes(q?.type) ? q.type : 'text';
    const out = { key, label, type, required: !!q?.required };
    if (type === 'select') {
      out.options = (Array.isArray(q?.options) ? q.options : String(q?.options || '').split(','))
        .map((o) => String(o).trim().slice(0, 80)).filter(Boolean).slice(0, 20);
      if (!out.options.length) errors.push(`"${label}" needs at least one option`);
    }
    return out;
  });
  return { form, errors };
}

/** Validate a customer's answers against the agency's questions. Unknown keys are dropped. */
export function validateAnswers(form, answers = {}) {
  const errors = [];
  const out = {};
  for (const q of Array.isArray(form) ? form : []) {
    const raw = answers?.[q.key];
    const empty = raw == null || String(raw).trim() === '';
    if (empty) { if (q.required) errors.push(`"${q.label}" is required`); continue; }
    const v = String(raw).trim();
    if (q.type === 'number') {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || n > 1e12) errors.push(`"${q.label}" must be a number`); else out[q.key] = n;
    } else if (q.type === 'date') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(new Date(v).getTime())) errors.push(`"${q.label}" must be a date`); else out[q.key] = v;
    } else if (q.type === 'select') {
      if (!(q.options || []).includes(v)) errors.push(`Choose an option for "${q.label}"`); else out[q.key] = v;
    } else if (q.type === 'yesno') {
      if (!['yes', 'no'].includes(v.toLowerCase())) errors.push(`Answer yes or no for "${q.label}"`); else out[q.key] = v.toLowerCase();
    } else {
      out[q.key] = v.slice(0, q.type === 'textarea' ? 2000 : 300);
    }
  }
  return { answers: out, errors };
}

/** Customer-safe view. Never includes staff_note. */
export function toPublicApplication(a, { property, documents, form } = {}) {
  const s = APP_STATUS[a.status] || APP_STATUS.submitted;
  return {
    id: a.id, reference: a.reference, kind: a.kind, status: a.status, status_label: s.label, next_step: s.next,
    customer_message: a.customer_message || null,
    requested_documents: Array.isArray(a.requested_documents) ? a.requested_documents : [],
    answers: form ? form.filter((q) => a.answers?.[q.key] != null).map((q) => ({ label: q.label, value: a.answers[q.key] })) : undefined,
    property: property ? { id: property.id, title: property.title } : null,
    documents: (documents || []).map((d) => ({ id: d.id, file_name: d.file_name, label: d.label, size_bytes: d.size_bytes, uploaded_by: d.uploaded_by, created_at: d.created_at })),
    can_upload: CUSTOMER_UPLOAD_STATUSES.includes(a.status),
    can_withdraw: OPEN_STATUSES.includes(a.status),
    created_at: a.created_at, updated_at: a.updated_at,
  };
}

/** Status update to the customer — respects their notification preferences; never sent twice. */
export async function notifyApplication(companyId, app, client) {
  const prefs = { whatsapp: true, email: true, ...(client?.notification_prefs || {}) };
  const { data: company } = await db.from('companies').select('name').eq('id', companyId).single();
  const s = APP_STATUS[app.status];
  if (!s || app.status === 'submitted' || app.status === 'withdrawn') return { sent: false };
  const text = `${company?.name || 'Your agency'}: your application ${app.reference} is now "${s.label}". ${app.customer_message ? app.customer_message + ' ' : ''}Sign in to the agency website for details.`;
  const key = `application:${app.id}:${app.status}:${app.updated_at}`;
  if (client?.verified_phone && prefs.whatsapp) return { sent: true, r: await sendMessage('whatsapp', client.verified_phone, text, 'application', { companyId, dedupeKey: `${key}:wa` }) };
  if (client?.verified_email && prefs.email) return { sent: true, r: await sendMessage('email', client.verified_email, text, 'application', { companyId, dedupeKey: `${key}:email` }) };
  return { sent: false, reason: 'customer opted out or has no verified contact' };
}
