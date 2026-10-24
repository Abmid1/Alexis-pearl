import { Router } from 'express';
import { auth, roles, STAFF, MANAGERS } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { checkRefs } from '../lib/tenant.js';
import { overlaps } from '../lib/scheduling.js';
import { notifyViewingChange } from '../lib/viewings.js';

/**
 * Staff viewing management. Requests arrive from the public site as "requested";
 * only staff can confirm. Postgres exclusion constraints make overlapping confirmed
 * viewings (same property, or same agent) impossible; we also pre-check here to
 * give a clear message.
 */
const router = Router();
router.use(auth, roles(...STAFF));

const SELECT = '*, property:property_id(id,title,location,availability), lead:lead_id(id,name,stage,owner_id), agent:agent_id(id,name), enquiry:enquiry_id(reference,contact_consent,message)';

/** Agents see viewings assigned to them or on their own leads; managers see all. */
async function canSee(req, v) {
  if (req.user.role !== 'agent') return true;
  if (v.agent_id === req.user.id) return true;
  if (!v.lead_id) return false;
  const { data } = await req.tdb.from('leads').select('owner_id').eq('id', v.lead_id).maybeSingle();
  return data?.owner_id === req.user.id;
}

async function load(req, res) {
  const { data: v } = await req.tdb.from('viewings').select('*').eq('id', req.params.id).maybeSingle();
  if (!v || !(await canSee(req, v))) { res.status(404).json({ error: 'Viewing not found' }); return null; }
  return v;
}

router.get('/', async (req, res) => {
  let q = req.tdb.from('viewings').select(SELECT).order('starts_at', { ascending: true }).limit(300);
  const status = String(req.query.status || '');
  if (status && status !== 'all') q = q.in('status', status.split(',').slice(0, 6));
  if (req.query.from) q = q.gte('starts_at', new Date(String(req.query.from)).toISOString());
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  let rows = data || [];
  if (req.user.role === 'agent') rows = rows.filter((v) => v.agent_id === req.user.id || v.lead?.owner_id === req.user.id);
  res.json(rows);
});

/** Clash check against other CONFIRMED viewings (property and agent). */
async function clash(req, v, { starts_at, ends_at, agent_id }) {
  const { data } = await req.tdb.from('viewings').select('id,property_id,agent_id,starts_at,ends_at,reference')
    .eq('status', 'confirmed').neq('id', v.id).lt('starts_at', ends_at).gt('ends_at', starts_at);
  const hit = (data || []).find((o) => overlaps(o.starts_at, o.ends_at, starts_at, ends_at)
    && (o.property_id === v.property_id || (agent_id && o.agent_id === agent_id)));
  if (!hit) return null;
  return hit.property_id === v.property_id ? `Clashes with confirmed viewing ${hit.reference} at this property` : `The agent already has viewing ${hit.reference} at that time`;
}

function parseTimes(body, v) {
  const s = body.starts_at ? new Date(body.starts_at) : new Date(v.starts_at);
  if (Number.isNaN(s.getTime())) return { error: 'Invalid start time' };
  const dur = body.duration_minutes ? Number(body.duration_minutes) : (new Date(v.ends_at) - new Date(v.starts_at)) / 60000;
  if (!Number.isFinite(dur) || dur < 15 || dur > 480) return { error: 'Duration must be 15–480 minutes' };
  return { starts_at: s.toISOString(), ends_at: new Date(s.getTime() + dur * 60000).toISOString() };
}

async function consentFor(req, v) {
  if (!v.enquiry_id) return false;
  const { data } = await req.tdb.from('enquiries').select('contact_consent').eq('id', v.enquiry_id).maybeSingle();
  return !!data?.contact_consent;
}

async function save(req, res, v, patch, action, after) {
  patch.updated_at = new Date().toISOString();
  const { data, error } = await req.tdb.from('viewings').update(patch).eq('id', v.id).select().single();
  if (error) {
    if (error.code === '23P01') return res.status(409).json({ error: 'That time overlaps another confirmed viewing for this property or agent.' });
    return res.status(500).json({ error: error.message });
  }
  if (after) await after(data);
  let notified = { sent: false };
  if (req.body?.notify !== false && ['confirmed', 'declined', 'cancelled'].includes(data.status)) {
    notified = await notifyViewingChange(req.user.company_id, data, { consent: await consentFor(req, data) });
  }
  // the customer's thread shows what happened (visible on their tracking page)
  const enquiry = v.enquiry_id ? (await req.tdb.from('enquiries').select('conversation_id').eq('id', v.enquiry_id).maybeSingle()).data : null;
  const text = {
    confirmed: `Your viewing (${data.reference}) is confirmed for ${new Date(data.starts_at).toUTCString().replace(':00 GMT', ' GMT')}.`,
    declined: `We couldn't offer the requested viewing time (${data.reference}).${data.decline_reason ? ' ' + data.decline_reason : ''} Please choose another slot.`,
    cancelled: `Your viewing (${data.reference}) has been cancelled by the agency.${req.body?.reason ? ' ' + String(req.body.reason).slice(0, 300) : ''}`,
  }[action === 'rescheduled' && data.status === 'confirmed' ? 'confirmed' : data.status];
  if (enquiry?.conversation_id && text && ['confirmed', 'declined', 'cancelled', 'rescheduled'].includes(action)) {
    await req.tdb.child('messages').insert({ conversation_id: enquiry.conversation_id, direction: 'out', body: text, sender_type: 'agent', sender_id: req.user.id });
    await req.tdb.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', enquiry.conversation_id);
  }
  await audit(req.user, action, 'viewing', v.id, { reference: v.reference, status: data.status, starts_at: data.starts_at, notified: notified.sent });
  res.json({ ...data, notified });
}

/** Confirm (optionally with a different time/agent). Moves the lead into the "viewing" stage. */
router.post('/:id/confirm', async (req, res) => {
  const v = await load(req, res); if (!v) return;
  if (!['requested', 'declined'].includes(v.status)) return res.status(409).json({ error: `Cannot confirm a ${v.status} viewing` });
  if (!(await checkRefs(req, res, { agent_id: 'users' }))) return;
  const t = parseTimes(req.body || {}, v);
  if (t.error) return res.status(400).json({ error: t.error });
  const agent_id = req.body?.agent_id || v.agent_id || req.user.id;
  const { data: prop } = await req.tdb.from('properties').select('availability,listing_status').eq('id', v.property_id).single();
  if (['sold', 'rented'].includes(prop?.availability)) return res.status(409).json({ error: `Property is ${prop.availability} — decline the request instead` });
  const c = await clash(req, v, { ...t, agent_id });
  if (c) return res.status(409).json({ error: c });
  return save(req, res, v, { status: 'confirmed', ...t, agent_id, decline_reason: null }, 'confirmed', async () => {
    if (!v.lead_id) return;
    // existing pipeline: a confirmed viewing moves an early-stage lead to "viewing"
    const { data: lead } = await req.tdb.from('leads').select('stage').eq('id', v.lead_id).single();
    if (['new', 'contacted'].includes(lead?.stage)) {
      await req.tdb.from('leads').update({ stage: 'viewing', next_follow_up: t.ends_at, updated_at: new Date().toISOString() }).eq('id', v.lead_id);
    }
  });
});

router.post('/:id/decline', async (req, res) => {
  const v = await load(req, res); if (!v) return;
  if (v.status !== 'requested') return res.status(409).json({ error: `Cannot decline a ${v.status} viewing` });
  const reason = req.body?.reason ? String(req.body.reason).slice(0, 300) : null;
  return save(req, res, v, { status: 'declined', decline_reason: reason }, 'declined');
});

/** Move a viewing. A confirmed viewing stays confirmed (clash-checked); a request stays a request. */
router.post('/:id/reschedule', async (req, res) => {
  const v = await load(req, res); if (!v) return;
  if (!['requested', 'confirmed'].includes(v.status)) return res.status(409).json({ error: `Cannot move a ${v.status} viewing` });
  const t = parseTimes(req.body || {}, v);
  if (t.error) return res.status(400).json({ error: t.error });
  if (v.status === 'confirmed') {
    const c = await clash(req, v, { ...t, agent_id: v.agent_id });
    if (c) return res.status(409).json({ error: c });
  }
  return save(req, res, v, { ...t }, 'rescheduled');
});

router.post('/:id/cancel', async (req, res) => {
  const v = await load(req, res); if (!v) return;
  if (!['requested', 'confirmed'].includes(v.status)) return res.status(409).json({ error: `Cannot cancel a ${v.status} viewing` });
  return save(req, res, v, { status: 'cancelled', cancelled_by: 'staff' }, 'cancelled');
});

/** Attendance + outcome after the viewing. */
router.post('/:id/outcome', async (req, res) => {
  const v = await load(req, res); if (!v) return;
  const status = req.body?.status;
  if (!['completed', 'no_show'].includes(status)) return res.status(400).json({ error: 'status must be completed or no_show' });
  if (v.status !== 'confirmed') return res.status(409).json({ error: 'Only confirmed viewings can be marked attended or missed' });
  return save(req, res, v, { status, outcome: req.body?.outcome ? String(req.body.outcome).slice(0, 2000) : null }, status === 'completed' ? 'viewing_completed' : 'viewing_no_show');
});

/** Assign an agent / internal note. Reassignment is for managers or the current agent. */
router.patch('/:id', async (req, res) => {
  const v = await load(req, res); if (!v) return;
  const patch = {};
  if ('staff_note' in (req.body || {})) patch.staff_note = String(req.body.staff_note || '').slice(0, 2000) || null;
  if ('agent_id' in (req.body || {})) {
    if (!MANAGERS.includes(req.user.role) && v.agent_id !== req.user.id) return res.status(403).json({ error: 'Only managers can reassign' });
    if (!(await checkRefs(req, res, { agent_id: 'users' }))) return;
    if (v.status === 'confirmed' && req.body.agent_id) {
      const c = await clash(req, v, { starts_at: v.starts_at, ends_at: v.ends_at, agent_id: req.body.agent_id });
      if (c) return res.status(409).json({ error: c });
    }
    patch.agent_id = req.body.agent_id || null;
  }
  if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to update' });
  return save(req, res, v, patch, 'updated');
});

export default router;
