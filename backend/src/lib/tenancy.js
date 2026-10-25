/**
 * Existing-tenant portal: rent and maintenance for a signed-in customer who holds
 * a lease. Built entirely on records staff already manage (leases, payments, tickets)
 * — no new source of truth. Rent has no formal schedule table, so figures are derived
 * from recorded payments and the tenancy's anchor day, and labelled honestly.
 */

const TICKET_STATUS = {
  open: { label: 'Reported', next: 'The agency has your request and will arrange a fix.' },
  in_progress: { label: 'In progress', next: 'Someone is working on this.' },
  resolved: { label: 'Resolved', next: 'Marked as done by the agency. Let them know if it needs more attention.' },
};

const startOfDayUTC = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
function onDay(year, month, day) {
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(day, daysInMonth)));
}

/** Rent is due on the tenancy's start day-of-month. Returns the next due date ≥ today. */
export function nextRentDue(startDate, now = new Date()) {
  const start = new Date(startDate);
  if (Number.isNaN(start.getTime())) return null;
  const day = start.getUTCDate();
  const today = startOfDayUTC(now);
  let due = onDay(now.getUTCFullYear(), now.getUTCMonth(), day);
  if (due < today) due = onDay(now.getUTCFullYear(), now.getUTCMonth() + 1, day);
  return due.toISOString().slice(0, 10);
}

const inThisMonth = (iso, now) => {
  const d = new Date(iso);
  return d.getUTCFullYear() === now.getUTCFullYear() && d.getUTCMonth() === now.getUTCMonth();
};

/** Customer-safe lease view with rent figures derived from recorded payments. */
export function toPublicLease(lease, { payments = [], now = new Date() } = {}) {
  const rent = Number(lease.rent_amount) || 0;
  const mine = payments.filter((p) => p.lease_id === lease.id);
  const paidThisMonth = mine.filter((p) => inThisMonth(p.created_at, now)).reduce((s, p) => s + Number(p.amount), 0);
  const balanceThisMonth = Math.max(0, rent - paidThisMonth);
  const last = mine.slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0] || null;
  const end = lease.end_date ? new Date(lease.end_date) : null;
  const daysToEnd = end ? Math.ceil((end - startOfDayUTC(now)) / 86400000) : null;
  return {
    id: lease.id,
    property: lease.property ? { title: lease.property.title, location: lease.property.location || null } : null,
    unit: lease.unit?.name || null,
    rent_amount: rent,
    currency: 'GHS',
    period: 'month',
    status: lease.status,
    start_date: lease.start_date,
    end_date: lease.end_date,
    days_to_end: daysToEnd,
    renewal_due: daysToEnd != null && daysToEnd <= 60 && daysToEnd > 0,
    expired: daysToEnd != null && daysToEnd <= 0,
    next_due_date: lease.status === 'active' ? nextRentDue(lease.start_date, now) : null,
    paid_this_month: paidThisMonth,
    balance_this_month: balanceThisMonth,
    in_arrears: lease.status === 'active' && balanceThisMonth > 0,
    last_payment: last ? { amount: Number(last.amount), method: last.method, date: last.created_at } : null,
  };
}

export function toPublicRentPayment(p) {
  return { id: p.id, amount: Number(p.amount), method: p.method, status: p.status, date: p.created_at };
}

export function toPublicTicket(t) {
  const s = TICKET_STATUS[t.status] || TICKET_STATUS.open;
  return {
    id: t.id, title: t.title, description: t.description || null,
    status: t.status, status_label: s.label, next_step: s.next,
    property: t.property?.title || null, unit: t.unit?.name || null,
    created_at: t.created_at,
  };
}

/** Validate a customer's maintenance request. */
export function validateMaintenance(input = {}) {
  const errors = [];
  const title = String(input.title || '').trim().slice(0, 200);
  if (title.length < 3) errors.push('Give the problem a short title');
  const description = String(input.description || '').trim().slice(0, 2000);
  if (description.length < 5) errors.push('Describe the problem so the agency can help');
  return { errors, value: { title, description } };
}
