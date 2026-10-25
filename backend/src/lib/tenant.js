import { db } from '../db.js';

/**
 * Tenant isolation.
 *
 * Every company-owned table carries company_id. Instead of trusting each route
 * to remember a filter, routes query through tenantDb(companyId), which:
 *   - adds  .eq('company_id', X)  to every select / update / delete
 *   - stamps company_id = X onto every inserted row (overriding anything sent)
 * The company id comes from the verified JWT (staff) or from the server-side
 * slug lookup (public site) — never from the request body.
 *
 * Child tables without company_id (messages, installments, commission_splits)
 * must be reached through a parent that was first loaded via tenantDb.
 */
export const TENANT_TABLES = new Set([
  'users', 'clients', 'leads', 'properties', 'units', 'deals', 'payment_plans', 'payments',
  'invoices', 'expenses', 'conversations', 'campaigns', 'documents', 'leases', 'tickets',
  'report_runs', 'outbox', 'audit_log', 'enquiries', 'viewings',
  'customer_otps', 'saved_properties', 'applications', 'application_documents',
  'document_requests', 'document_request_files', 'service_requests', 'offers', 'transactions',
]);

export function tenantDb(companyId, base = db) {
  if (!companyId) throw new Error('tenantDb requires a company id');
  return {
    companyId,
    from(table) {
      const q = base.from(table);
      if (!TENANT_TABLES.has(table)) {
        throw new Error(`"${table}" has no company_id — load it through its parent record`);
      }
      const stamp = (r) => ({ ...r, company_id: companyId });
      return {
        select: (...a) => q.select(...a).eq('company_id', companyId),
        insert: (rows, ...a) => q.insert(Array.isArray(rows) ? rows.map(stamp) : stamp(rows), ...a),
        update: (patch, ...a) => {
          const { company_id, ...rest } = patch || {};   // a record can never be moved to another company
          return q.update(rest, ...a).eq('company_id', companyId);
        },
        delete: (...a) => q.delete(...a).eq('company_id', companyId),
      };
    },
    /** Child-table access (no company_id column) — caller must have verified the parent. */
    child(table) {
      if (TENANT_TABLES.has(table)) throw new Error(`use from('${table}') for tenant tables`);
      return base.from(table);
    },
  };
}

/** True when every non-empty id refers to a row of `table` in this company. */
export async function ownsAll(tdb, table, ids) {
  const list = [...new Set(ids.filter(Boolean))];
  if (!list.length) return true;
  const { data } = await tdb.from(table).select('id').in('id', list);
  return (data || []).length === list.length;
}

/**
 * Express helper: reject foreign-company ids passed in a body.
 * Usage: if (!(await checkRefs(req, res, { property_id: 'properties' }))) return;
 */
export async function checkRefs(req, res, map, source = req.body || {}) {
  for (const [field, table] of Object.entries(map)) {
    const v = source[field];
    if (v && !(await ownsAll(req.tdb, table, [v]))) {
      res.status(400).json({ error: `Unknown ${field.replace(/_id$/, '')}` });
      return false;
    }
  }
  return true;
}

/** Resolve a company for the public website from its slug (server-side). */
export async function companyBySlug(slug) {
  if (typeof slug !== 'string' || !/^[a-z0-9-]{3,40}$/.test(slug)) return null;
  const { data } = await db.from('companies').select('*').eq('slug', slug).eq('public_enabled', true).maybeSingle();
  return data || null;
}

/** Resolve a company from a custom domain (for future host-based routing). */
export async function companyByDomain(host) {
  if (typeof host !== 'string' || host.length > 253) return null;
  const { data } = await db.from('companies').select('*').eq('custom_domain', host.toLowerCase()).eq('public_enabled', true).maybeSingle();
  return data || null;
}
