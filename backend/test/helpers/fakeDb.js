import { randomUUID } from 'node:crypto';

/**
 * In-memory stand-in for the subset of supabase-js used by the backend, so the
 * real Express routes can be exercised without a database. It mirrors the
 * constraints that matter for correctness: NOT NULL company_id, unique keys,
 * and the "no overlapping confirmed viewings" exclusion constraints.
 * It is NOT Postgres — RLS, triggers and SQL functions are not emulated.
 */

const FK = {
  owner_id: 'users', agent_id: 'users', assigned_to: 'users', submitted_by: 'users', decided_by: 'users',
  recorded_by: 'users', uploaded_by: 'users', user_id: 'users', approved_by: 'users', sender_id: 'users',
  client_id: 'clients', lead_id: 'leads', property_id: 'properties', deal_id: 'deals', unit_id: 'units',
  plan_id: 'payment_plans', campaign_id: 'campaigns', enquiry_id: 'enquiries', conversation_id: 'conversations',
  lease_id: 'leases', invoice_id: 'invoices', installment_id: 'installments',
};

const DEFAULTS = {
  users: { active: true, phone: null, company_id: null },
  leads: { stage: 'new', budget: 0, notes: null, interest: null, phone: null, email: null, next_follow_up: null, client_id: null, campaign_id: null },
  properties: { listing_status: 'draft', availability: 'available', amenities: [], images: [], managed: false, featured: false, show_exact_location: false, archived_at: null, published_at: null, ptype: 'sale' },
  conversations: { unread: false, ai_mode: 'auto', client_id: null, lead_id: null },
  messages: { is_draft: false, kb_source: null, sender_id: null },
  enquiries: { status: 'new', kind: 'enquiry', source: 'website', contact_consent: false, idempotency_key: null },
  viewings: { status: 'requested', agent_id: null, staff_note: null, outcome: null, decline_reason: null, cancelled_by: null },
  documents: { is_public: false, client_id: null, property_id: null },
  outbox: { status: 'simulated', dedupe_key: null },
  companies: { public_enabled: true, socials: {}, services: ['buy', 'rent'], settings: { commission_rate: 5, rr_cursor: 0 }, viewing_hours: null, custom_domain: null, whatsapp_phone_number_id: null },
  deals: { status: 'draft', commission_rate: 5 },
};

const NOT_NULL_COMPANY = ['clients', 'leads', 'properties', 'units', 'deals', 'payment_plans', 'payments', 'invoices',
  'expenses', 'conversations', 'campaigns', 'documents', 'leases', 'tickets', 'report_runs', 'enquiries', 'viewings'];

const UNIQUE = {
  users: [['email']], companies: [['slug']], enquiries: [['reference'], ['company_id', 'idempotency_key']],
  viewings: [['reference']], outbox: [['dedupe_key']], invoices: [['company_id', 'number']],
};

const err = (code, message) => ({ code, message });

function splitTop(s) {
  const out = []; let depth = 0; let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function likeToRegex(p) {
  let r = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '\\' && i + 1 < p.length) { r += p[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); continue; }
    if (c === '%') r += '.*'; else if (c === '_') r += '.'; else r += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${r}$`, 'is');
}

const cmp = (a, b) => (a == null && b == null ? 0 : a == null ? 1 : b == null ? -1 : a < b ? -1 : a > b ? 1 : 0);

export function createFakeDb() {
  const tables = {};
  const T = (name) => (tables[name] ||= []);

  function project(table, row, select) {
    if (!select || select.trim() === '*') return { ...row };
    const out = {};
    for (const item of splitTop(select)) {
      const m = /^(?:(\w+):)?([\w]+)(?:!\w+)?\((.*)\)$/s.exec(item);
      if (!m) {
        if (item === '*') Object.assign(out, row);
        else { const col = item.trim(); out[col] = row[col]; }
        continue;
      }
      const [, alias, src, inner] = m;
      if (FK[src] && src in row) {                       // to-one via fk column
        const target = T(FK[src]).find((r) => r.id === row[src]);
        out[alias || src] = target ? project(FK[src], target, inner) : null;
      } else if (tables[src] || ['installments', 'commission_splits', 'messages'].includes(src)) { // to-many child
        const fkCol = Object.keys(FK).find((k) => FK[k] === table && T(src).some((r) => k in r)) || `${table.replace(/s$/, '')}_id`;
        out[alias || src] = T(src).filter((r) => r[fkCol] === row.id).map((r) => project(src, r, inner));
      } else {
        out[alias || src] = null;
      }
    }
    return out;
  }

  function checkConstraints(table, rows, all) {
    for (const r of rows) {
      if (NOT_NULL_COMPANY.includes(table) && !r.company_id) return err('23502', `null value in column "company_id" of relation "${table}"`);
    }
    for (const cols of UNIQUE[table] || []) {
      const seen = new Set();
      for (const r of all) {
        if (cols.some((c) => r[c] == null)) continue;
        const k = cols.map((c) => r[c]).join('|');
        if (seen.has(k)) return err('23505', `duplicate key value violates unique constraint on ${table}(${cols})`);
        seen.add(k);
      }
    }
    if (table === 'viewings') {
      const conf = all.filter((v) => v.status === 'confirmed');
      for (let i = 0; i < conf.length; i++) for (let j = i + 1; j < conf.length; j++) {
        const a = conf[i]; const b = conf[j];
        const ov = new Date(a.starts_at) < new Date(b.ends_at) && new Date(b.starts_at) < new Date(a.ends_at);
        if (ov && (a.property_id === b.property_id || (a.agent_id && a.agent_id === b.agent_id))) {
          return err('23P01', 'conflicting key value violates exclusion constraint');
        }
      }
    }
    return null;
  }

  class Q {
    constructor(table) { Object.assign(this, { table, op: 'select', filters: [], orders: [], sel: '*', returning: false }); }
    select(cols = '*', opts = {}) {
      if (this.op === 'select') { this.sel = cols; this.countMode = opts.count; this.head = opts.head; } else { this.returning = true; this.sel = cols; }
      return this;
    }
    insert(rows) { this.op = 'insert'; this.payload = rows; return this; }
    update(patch) { this.op = 'update'; this.payload = patch; return this; }
    upsert(rows) { this.op = 'insert'; this.payload = rows; return this; }
    delete() { this.op = 'delete'; return this; }
    _f(fn) { this.filters.push(fn); return this; }
    eq(c, v) { return this._f((r) => r[c] === v || (r[c] != null && v != null && String(r[c]) === String(v) && typeof v !== 'boolean')); }
    neq(c, v) { return this._f((r) => r[c] !== v); }
    gt(c, v) { return this._f((r) => r[c] != null && r[c] > v); }
    gte(c, v) { return this._f((r) => r[c] != null && r[c] >= v); }
    lt(c, v) { return this._f((r) => r[c] != null && r[c] < v); }
    lte(c, v) { return this._f((r) => r[c] != null && r[c] <= v); }
    in(c, vs) { return this._f((r) => vs.includes(r[c])); }
    is(c, v) { return this._f((r) => (v === null ? r[c] == null : r[c] === v)); }
    ilike(c, p) { const re = likeToRegex(p); return this._f((r) => r[c] != null && re.test(String(r[c]))); }
    contains(c, arr) { return this._f((r) => Array.isArray(r[c]) && arr.every((x) => r[c].includes(x))); }
    not(c, op, v) {
      if (op === 'is') return this._f((r) => (v === null ? r[c] != null : r[c] !== v));
      if (op === 'in') { const list = String(v).replace(/[()"]/g, '').split(','); return this._f((r) => !list.includes(r[c])); }
      return this._f((r) => r[c] !== v);
    }
    or(expr) {
      const parts = expr.split(',').map((p) => { const [c, op, ...rest] = p.split('.'); return { c, op, v: rest.join('.') }; });
      return this._f((r) => parts.some(({ c, op, v }) => (op === 'eq' ? String(r[c]) === v : op === 'ilike' ? r[c] != null && likeToRegex(v).test(String(r[c])) : false)));
    }
    order(c, { ascending = true, nullsFirst } = {}) { this.orders.push({ c, ascending, nullsFirst }); return this; }
    range(a, b) { this.rng = [a, b]; return this; }
    limit(n) { this.lim = n; return this; }
    single() { this.one = 'single'; return this; }
    maybeSingle() { this.one = 'maybe'; return this; }
    then(res, rej) { return Promise.resolve().then(() => this._run()).then(res, rej); }

    _run() {
      const rows = T(this.table);
      const match = (r) => this.filters.every((f) => f(r));
      let out; let error = null; let count = null;
      if (this.op === 'insert') {
        const list = (Array.isArray(this.payload) ? this.payload : [this.payload]).map((p) => ({
          id: randomUUID(), created_at: new Date().toISOString(), ...(DEFAULTS[this.table] || {}), ...structuredClone(p),
        }));
        error = checkConstraints(this.table, list, [...rows, ...list]);
        if (error) return this._finish(null, error);
        rows.push(...list);
        out = this.returning ? list : null;
      } else if (this.op === 'update') {
        const hit = rows.filter(match);
        const before = hit.map((r) => ({ ...r }));
        hit.forEach((r) => Object.assign(r, structuredClone(this.payload)));
        error = checkConstraints(this.table, hit, rows);
        if (error) { hit.forEach((r, i) => { Object.keys(r).forEach((k) => delete r[k]); Object.assign(r, before[i]); }); return this._finish(null, error); }
        out = this.returning ? hit : null;
      } else if (this.op === 'delete') {
        const keep = rows.filter((r) => !match(r));
        tables[this.table] = keep;
        out = null;
      } else {
        out = rows.filter(match);
        for (const o of [...this.orders].reverse()) {
          out = [...out].sort((a, b) => {
            const an = a[o.c] == null; const bn = b[o.c] == null;
            if (an !== bn) return (o.nullsFirst ?? !o.ascending) ? (an ? -1 : 1) : (an ? 1 : -1);
            const v = cmp(a[o.c], b[o.c]);
            return o.ascending ? v : -v;
          });
        }
        count = this.countMode ? out.length : null;
        if (this.rng) out = out.slice(this.rng[0], this.rng[1] + 1);
        if (this.lim != null) out = out.slice(0, this.lim);
        if (this.head) return { data: null, error: null, count };
      }
      if (out) out = out.map((r) => project(this.table, r, this.sel));
      return this._finish(out, null, count);
    }

    _finish(out, error, count = null) {
      if (error) return { data: null, error, count: null };
      if (this.one) {
        const list = out || [];
        if (list.length === 1) return { data: list[0], error: null, count };
        if (list.length === 0 && this.one === 'maybe') return { data: null, error: null, count };
        return { data: null, error: err('PGRST116', 'JSON object requested, multiple (or no) rows returned'), count };
      }
      return { data: out, error: null, count };
    }
  }

  return {
    tables,
    from: (t) => new Q(t),
    reset() { for (const k of Object.keys(tables)) delete tables[k]; },
  };
}
