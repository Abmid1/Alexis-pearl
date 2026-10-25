import { Router } from 'express';
import { auth, roles, STAFF, MANAGERS } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { APP_STATUS, notifyApplication } from '../lib/applications.js';
import { signedUrl } from '../lib/files.js';

/** Staff management of customer applications (workspace). */
const router = Router();
router.use(auth, roles(...STAFF));

const SELECT = '*, property:property_id(id,title), client:client_id(id,name,verified_phone,verified_email,notification_prefs), lead:lead_id(id,name,stage,owner_id, owner:owner_id(name))';

async function canSee(req, a) {
  if (req.user.role !== 'agent') return true;
  if (!a.lead_id) return false;
  const { data } = await req.tdb.from('leads').select('owner_id').eq('id', a.lead_id).maybeSingle();
  return data?.owner_id === req.user.id;
}

async function load(req, res) {
  const { data: a } = await req.tdb.from('applications').select(SELECT).eq('id', req.params.id).maybeSingle();
  if (!a || !(await canSee(req, a))) { res.status(404).json({ error: 'Application not found' }); return null; }
  return a;
}

router.get('/', async (req, res) => {
  let q = req.tdb.from('applications').select(SELECT).order('created_at', { ascending: false }).limit(300);
  if (req.query.status && req.query.status !== 'all') q = q.in('status', String(req.query.status).split(',').slice(0, 6));
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });
  let rows = data || [];
  if (req.user.role === 'agent') rows = rows.filter((a) => a.lead?.owner_id === req.user.id);
  res.json(rows);
});

router.get('/:id', async (req, res) => {
  const a = await load(req, res); if (!a) return;
  const { data: docs } = await req.tdb.from('application_documents')
    .select('id,file_name,mime_type,size_bytes,label,uploaded_by,created_at').eq('application_id', a.id).order('created_at');
  res.json({ ...a, documents: docs || [] });
});

/** Staff open a document: 60-second link, access logged. */
router.get('/:id/documents/:docId', async (req, res) => {
  const a = await load(req, res); if (!a) return;
  const { data: d } = await req.tdb.from('application_documents').select('*').eq('id', req.params.docId).eq('application_id', a.id).maybeSingle();
  if (!d) return res.status(404).json({ error: 'Document not found' });
  const url = await signedUrl(d.storage_path, 60);
  await audit(req.user, 'document_accessed', 'application_document', d.id, { application: a.reference, file: d.file_name });
  res.json({ url, expires_in: 60 });
});

const TRANSITIONS = {
  submitted: ['under_review', 'info_requested', 'approved', 'declined'],
  under_review: ['info_requested', 'approved', 'declined'],
  info_requested: ['under_review', 'approved', 'declined'],
  approved: ['declined'],
  declined: ['under_review'],
  withdrawn: [],
};

/**
 * Change status. "info_requested" can name the documents needed; the message is shown
 * to the customer. Approving or declining is limited to owners/admins.
 */
router.post('/:id/status', async (req, res) => {
  const a = await load(req, res); if (!a) return;
  const status = req.body?.status;
  if (!APP_STATUS[status] || status === 'withdrawn' || status === 'submitted') return res.status(400).json({ error: 'Invalid status' });
  if (!TRANSITIONS[a.status]?.includes(status)) return res.status(409).json({ error: `Cannot move from "${APP_STATUS[a.status].label}" to "${APP_STATUS[status].label}"` });
  if (['approved', 'declined'].includes(status) && !MANAGERS.includes(req.user.role)) return res.status(403).json({ error: 'Only owners and admins can approve or decline' });
  const message = req.body?.message ? String(req.body.message).trim().slice(0, 1000) : null;
  const docs = (Array.isArray(req.body?.requested_documents) ? req.body.requested_documents : [])
    .map((d) => ({ label: String(d?.label ?? d).trim().slice(0, 120) })).filter((d) => d.label).slice(0, 10);
  if (status === 'info_requested' && !message && !docs.length) return res.status(400).json({ error: 'Tell the customer what you need' });

  const patch = { status, customer_message: message, updated_at: new Date().toISOString() };
  if (status === 'info_requested') patch.requested_documents = docs;
  const { data } = await req.tdb.from('applications').update(patch).eq('id', a.id).select().single();

  // thread message (customer sees it on their tracking page) + optional notification
  if (a.enquiry_id) {
    const { data: e } = await req.tdb.from('enquiries').select('conversation_id').eq('id', a.enquiry_id).maybeSingle();
    if (e?.conversation_id) {
      const text = `Application ${a.reference}: ${APP_STATUS[status].label}.${message ? ' ' + message : ''}${docs.length ? ` Please upload: ${docs.map((d) => d.label).join(', ')}.` : ''}`;
      await req.tdb.child('messages').insert({ conversation_id: e.conversation_id, direction: 'out', body: text, sender_type: 'agent', sender_id: req.user.id });
      await req.tdb.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', e.conversation_id);
    }
  }
  const notified = req.body?.notify === false ? { sent: false } : await notifyApplication(req.user.company_id, data, a.client);
  await audit(req.user, `application_${status}`, 'application', a.id, { reference: a.reference, notified: notified.sent });
  res.json({ ...data, notified: { sent: notified.sent } });
});

router.patch('/:id', async (req, res) => {
  const a = await load(req, res); if (!a) return;
  if (!('staff_note' in (req.body || {}))) return res.status(400).json({ error: 'Nothing to update' });
  const { data } = await req.tdb.from('applications').update({ staff_note: String(req.body.staff_note || '').slice(0, 2000) || null, updated_at: new Date().toISOString() }).eq('id', a.id).select().single();
  await audit(req.user, 'updated', 'application', a.id, { reference: a.reference });
  res.json(data);
});

export default router;
