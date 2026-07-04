import { db } from '../db.js';

/** Audit log — who changed what, when. Never throws (logging must not break the action). */
export async function audit(user, action, entity, entityId, detail = {}) {
  try {
    await db.from('audit_log').insert({
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
