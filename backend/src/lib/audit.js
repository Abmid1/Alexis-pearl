import { db } from '../db.js';

/**
 * Audit log — who changed what, when. Never throws (logging must not break the action).
 * The company comes from the acting user, or explicitly for system/public events.
 */
export async function audit(user, action, entity, entityId, detail = {}, companyId = null) {
  try {
    await db.from('audit_log').insert({
      company_id: companyId || user?.company_id || null,
      user_id: user?.id || null,
      user_name: user?.name || 'system',
      action, entity,
      entity_id: entityId || null,
      detail,
    });
  } catch (e) {
    console.error('audit failed:', e.message);
  }
}
