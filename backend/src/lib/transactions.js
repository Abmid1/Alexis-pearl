/**
 * Transaction progress shown to the customer: a short list of milestones staff
 * tick off as a purchase or tenancy moves along. It links to the existing CRM
 * deal rather than duplicating it, and records only what staff have confirmed.
 * It is a progress tracker, not a legal record of completion.
 */

export const MILESTONE_STATES = ['pending', 'in_progress', 'done', 'blocked'];

export const STATE_LABEL = {
  pending: 'Not started', in_progress: 'In progress', done: 'Done', blocked: 'On hold',
};

export const TEMPLATES = {
  sale: [
    { key: 'reserved', label: 'Property reserved' },
    { key: 'agreement', label: 'Sale agreement signed' },
    { key: 'payments', label: 'Payments in progress' },
    { key: 'documentation', label: 'Documentation prepared' },
    { key: 'handover', label: 'Handover and keys' },
  ],
  rental: [
    { key: 'approved', label: 'Application approved' },
    { key: 'agreement', label: 'Tenancy agreement signed' },
    { key: 'deposit', label: 'Rent advance and deposit paid' },
    { key: 'inspection', label: 'Move-in inspection' },
    { key: 'keys', label: 'Keys handed over' },
  ],
};

export const defaultMilestones = (kind) =>
  (TEMPLATES[kind] || TEMPLATES.sale).map((m) => ({ ...m, state: 'pending', note: null, completed_at: null }));

/** Validate a milestone list coming from staff. */
export function validateMilestones(input) {
  const errors = [];
  if (!Array.isArray(input)) return { milestones: null, errors: ['Milestones must be a list'] };
  if (input.length > 20) errors.push('At most 20 milestones');
  const keys = new Set();
  const milestones = input.slice(0, 20).map((m, i) => {
    const label = String(m?.label || '').trim().slice(0, 120);
    if (!label) errors.push(`Milestone ${i + 1} needs a name`);
    let key = String(m?.key || label).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || `m${i + 1}`;
    while (keys.has(key)) key = `${key}_${i + 1}`;
    keys.add(key);
    const state = MILESTONE_STATES.includes(m?.state) ? m.state : 'pending';
    return {
      key, label, state,
      note: String(m?.note || '').trim().slice(0, 400) || null,
      completed_at: state === 'done' ? (m?.completed_at || new Date().toISOString()) : null,
    };
  });
  return { milestones, errors };
}

export function toPublicTransaction(t, { property } = {}) {
  const milestones = Array.isArray(t.milestones) ? t.milestones : [];
  const done = milestones.filter((m) => m.state === 'done').length;
  const current = milestones.find((m) => m.state === 'in_progress') || milestones.find((m) => m.state !== 'done') || null;
  return {
    id: t.id, reference: t.reference, kind: t.kind, status: t.status,
    property: property ? { id: property.id, title: property.title } : null,
    customer_message: t.customer_message || null,
    progress: { done, total: milestones.length },
    current_step: current ? current.label : null,
    milestones: milestones.map((m) => ({
      key: m.key, label: m.label, state: m.state, state_label: STATE_LABEL[m.state] || 'Not started',
      note: m.note || null, completed_at: m.completed_at || null,
    })),
    updated_at: t.updated_at,
  };
}
