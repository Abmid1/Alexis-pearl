/**
 * Internal viewing scheduler (no external calendar is assumed).
 *
 * The company's viewing_hours define bookable slots. Ghana is UTC+0 all year with
 * no daylight saving, so slot times are computed in UTC and are correct for Accra.
 * (A companies.timezone field is the extension point for other countries.)
 */

export const DEFAULT_HOURS = {
  days: [1, 2, 3, 4, 5, 6], start: '09:00', end: '16:00', slot_minutes: 45,
  min_notice_hours: 24, max_days_ahead: 21, cancel_cutoff_hours: 2,
};

export function hoursFor(company) {
  return { ...DEFAULT_HOURS, ...(company?.viewing_hours || {}) };
}

const toMin = (hhmm) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
  if (!m) return null;
  const v = Number(m[1]) * 60 + Number(m[2]);
  return v >= 0 && v <= 24 * 60 ? v : null;
};

export function overlaps(aStart, aEnd, bStart, bEnd) {
  return new Date(aStart) < new Date(bEnd) && new Date(bStart) < new Date(aEnd);
}

/**
 * All slots between now+notice and now+max_days_ahead, minus those that overlap
 * a confirmed viewing in `busy` ([{starts_at, ends_at}]).
 */
export function generateSlots(hours, { now = new Date(), busy = [], days } = {}) {
  const h = { ...DEFAULT_HOURS, ...hours };
  const start = toMin(h.start); const end = toMin(h.end);
  const len = Math.max(15, Math.min(240, Number(h.slot_minutes) || 45));
  if (start == null || end == null || end <= start) return [];
  const earliest = new Date(now.getTime() + (Number(h.min_notice_hours) || 0) * 3600000);
  const horizon = Math.min(Number(days ?? h.max_days_ahead) || 21, 60);
  const out = [];
  const day0 = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  for (let d = 0; d <= horizon; d++) {
    const base = day0 + d * 86400000;
    const dow = new Date(base).getUTCDay();
    if (!h.days.includes(dow)) continue;
    for (let m = start; m + len <= end; m += len) {
      const s = new Date(base + m * 60000);
      const e = new Date(s.getTime() + len * 60000);
      if (s < earliest) continue;
      if (busy.some((b) => overlaps(s, e, b.starts_at, b.ends_at))) continue;
      out.push({ starts_at: s.toISOString(), ends_at: e.toISOString() });
    }
  }
  return out;
}

/** Is `startsAt` exactly one of the currently offered slots? Returns the slot or null. */
export function findSlot(hours, startsAt, opts) {
  const t = new Date(startsAt);
  if (Number.isNaN(t.getTime())) return null;
  return generateSlots(hours, opts).find((s) => new Date(s.starts_at).getTime() === t.getTime()) || null;
}

/** May the customer still cancel/reschedule? */
export function withinCustomerCutoff(hours, startsAt, now = new Date()) {
  const cutoff = Number({ ...DEFAULT_HOURS, ...hours }.cancel_cutoff_hours) || 0;
  return new Date(startsAt).getTime() - now.getTime() >= cutoff * 3600000;
}
