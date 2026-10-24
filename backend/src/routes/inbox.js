import { Router } from 'express';
import { auth, roles, STAFF } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { sendMessage } from '../lib/integrations.js';
import { handleInbound } from '../lib/inbound.js';
import { checkRefs } from '../lib/tenant.js';

const router = Router();
router.use(auth, roles(...STAFF));

/** 1d — unified inbox. Agents see conversations assigned to them; managers see all. */
router.get('/', async (req, res) => {
  let q = req.tdb.from('conversations')
    .select('*, lead:lead_id(id,name,stage), client:client_id(id,name), agent:assigned_to(id,name)')
    .order('last_message_at', { ascending: false });
  if (req.user.role === 'agent') q = q.eq('assigned_to', req.user.id);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  // attach last visible message + pending-draft flag
  const out = [];
  for (const c of data || []) {
    const [{ data: last }, { count: drafts }] = await Promise.all([
      req.tdb.child('messages').select('body,sender_type,direction,created_at').eq('conversation_id', c.id).eq('is_draft', false).order('created_at', { ascending: false }).limit(1),
      req.tdb.child('messages').select('id', { count: 'exact', head: true }).eq('conversation_id', c.id).eq('is_draft', true),
    ]);
    out.push({ ...c, lastMessage: last?.[0] || null, pendingDrafts: drafts || 0 });
  }
  res.json(out);
});

/** Full thread (drafts included — they render as review cards). */
router.get('/:id', async (req, res) => {
  const { data: conv } = await req.tdb.from('conversations')
    .select('*, lead:lead_id(id,name,stage,source), client:client_id(id,name), agent:assigned_to(id,name)')
    .eq('id', req.params.id).single();
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });
  if (req.user.role === 'agent' && conv.assigned_to !== req.user.id) return res.status(403).json({ error: 'Not assigned to you' });

  const { data: messages } = await req.tdb.child('messages').select('*').eq('conversation_id', req.params.id).order('created_at');
  await req.tdb.from('conversations').update({ unread: false }).eq('id', req.params.id);
  res.json({ ...conv, messages: messages || [] });
});

/** Agent sends a message — routes back through the original channel. */
router.post('/:id/send', async (req, res) => {
  const { text } = req.body || {};
  if (!text?.trim()) return res.status(400).json({ error: 'text required' });
  const { data: conv } = await req.tdb.from('conversations').select('*').eq('id', req.params.id).single();
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });

  const { data: msg } = await req.tdb.child('messages').insert({
    conversation_id: conv.id, direction: 'out', body: text.trim(),
    sender_type: 'agent', sender_id: req.user.id,
  }).select().single();
  await sendMessage(conv.channel, conv.contact_addr, text.trim(), 'reply', { companyId: req.user.company_id });
  await req.tdb.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conv.id);
  await audit(req.user, 'sent', 'message', conv.id, { channel: conv.channel });
  res.json(msg);
});

/** Approve an AI draft (optionally edited) → sends through the channel. */
router.post('/:id/drafts/:draftId/approve', async (req, res) => {
  const { data: conv } = await req.tdb.from('conversations').select('*').eq('id', req.params.id).maybeSingle();
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });
  const { data: draft } = await req.tdb.child('messages').select('*').eq('id', req.params.draftId).eq('conversation_id', conv.id).eq('is_draft', true).maybeSingle();
  if (!draft) return res.status(404).json({ error: 'Draft not found (already handled?)' });

  const finalText = (req.body?.text || draft.body).trim();
  const edited = finalText !== draft.body;
  await req.tdb.child('messages').update({
    is_draft: false, body: finalText,
    sender_type: edited ? 'agent' : 'ai',      // edited drafts go out as the agent
    sender_id: req.user.id,
  }).eq('id', draft.id);
  await sendMessage(conv.channel, conv.contact_addr, finalText, 'draft-approved', { companyId: req.user.company_id, dedupeKey: `draft:${draft.id}` });
  await req.tdb.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conv.id);
  await audit(req.user, edited ? 'edited_and_sent_draft' : 'approved_draft', 'message', draft.id, {});
  res.json({ ok: true });
});

/** Discard an AI draft. */
router.delete('/:id/drafts/:draftId', async (req, res) => {
  const { data: conv } = await req.tdb.from('conversations').select('id').eq('id', req.params.id).maybeSingle();
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });
  await req.tdb.child('messages').delete().eq('id', req.params.draftId).eq('conversation_id', conv.id).eq('is_draft', true);
  await audit(req.user, 'discarded_draft', 'message', req.params.draftId, {});
  res.json({ ok: true });
});

/** Take over: flips Auto → Suggest (agent handles it personally). Toggle back when done. */
router.post('/:id/mode', async (req, res) => {
  const mode = req.body?.mode;
  if (!['auto', 'suggest'].includes(mode)) return res.status(400).json({ error: 'mode must be auto or suggest' });
  const patch = { ai_mode: mode };
  if (mode === 'suggest') patch.assigned_to = req.user.id; // taking over assigns it to you
  const { data, error } = await req.tdb.from('conversations').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  await audit(req.user, mode === 'suggest' ? 'took_over' : 'returned_to_auto', 'conversation', req.params.id, {});
  res.json(data);
});

/** Assign an unassigned conversation. */
router.post('/:id/assign', async (req, res) => {
  const userId = req.body?.user_id || req.user.id;
  if (!(await checkRefs(req, res, { user_id: 'users' }))) return;
  const { data, error } = await req.tdb.from('conversations').update({ assigned_to: userId }).eq('id', req.params.id).select('*, agent:assigned_to(id,name)').single();
  if (error) return res.status(500).json({ error: error.message });
  await audit(req.user, 'assigned', 'conversation', req.params.id, { to: data.agent?.name });
  res.json(data);
});

/**
 * Demo simulator — behaves exactly like a webhook: creates the lead,
 * stores the message, triggers the AI. Lets you test the whole flow
 * before Meta credentials exist.
 */
router.post('/simulate-inbound', async (req, res) => {
  const { channel = 'whatsapp', from_addr, from_name, body } = req.body || {};
  if (!from_addr || !body) return res.status(400).json({ error: 'from_addr and body required' });
  const result = await handleInbound({ companyId: req.user.company_id, channel, fromAddr: from_addr, fromName: from_name, body });
  res.json(result);
});

export default router;
