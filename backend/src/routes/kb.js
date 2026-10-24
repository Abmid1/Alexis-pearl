import { Router } from 'express';
import { auth, roles, STAFF, MANAGERS } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { kbAnswer } from '../lib/ai.js';
import { checkRefs } from '../lib/tenant.js';

const router = Router();
router.use(auth, roles(...STAFF));

/** 1i — knowledge base. One brain: staff search, inbox drafts, website chatbot. */
router.get('/', async (req, res) => {
  const { data } = await req.tdb.from('documents')
    .select('id,title,category,file_url,client_id,property_id,is_public,created_at,uploader:uploaded_by(name), content_text')
    .order('created_at', { ascending: false });
  res.json((data || []).map((d) => ({ ...d, excerpt: d.content_text?.slice(0, 160) || null, content_text: undefined })));
});

/** Upload once — text content becomes searchable and powers all three AI surfaces. */
router.post('/', async (req, res) => {
  const { title, category, content_text, file_url, client_id, property_id, is_public } = req.body || {};
  if (!title || !category) return res.status(400).json({ error: 'title and category required' });
  if (!(await checkRefs(req, res, { client_id: 'clients', property_id: 'properties' }))) return;
  if (is_public && client_id) return res.status(400).json({ error: 'A client document can never be public' });
  const { data, error } = await req.tdb.from('documents').insert({
    title, category, content_text: content_text || null, file_url: file_url || null,
    client_id: client_id || null, property_id: property_id || null, uploaded_by: req.user.id,
    is_public: !!is_public,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  await audit(req.user, 'uploaded', 'document', data.id, { title, category });
  res.json(data);
});

/** Mark a document as public — it may then answer customer questions on the website assistant. */
router.patch('/:id/visibility', roles(...MANAGERS), async (req, res) => {
  const isPublic = !!req.body?.is_public;
  const { data: doc } = await req.tdb.from('documents').select('id,client_id,title').eq('id', req.params.id).maybeSingle();
  if (!doc) return res.status(404).json({ error: 'Document not found' });
  if (isPublic && doc.client_id) return res.status(400).json({ error: 'A client document can never be public' });
  const { data } = await req.tdb.from('documents').update({ is_public: isPublic }).eq('id', doc.id).select('id,is_public').single();
  await audit(req.user, isPublic ? 'made_public' : 'made_private', 'document', doc.id, { title: doc.title });
  res.json(data);
});

router.delete('/:id', roles(...MANAGERS), async (req, res) => {
  await req.tdb.from('documents').delete().eq('id', req.params.id);
  await audit(req.user, 'deleted', 'document', req.params.id, {});
  res.json({ ok: true });
});

/** Ask-anything — answers with the source document cited. */
router.post('/ask', async (req, res) => {
  const { question } = req.body || {};
  if (!question?.trim()) return res.status(400).json({ error: 'question required' });
  const result = await kbAnswer(req.user.company_id, question.trim());
  res.json(result);
});

export default router;
