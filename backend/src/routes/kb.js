import { Router } from 'express';
import { db } from '../db.js';
import { auth, roles, STAFF, MANAGERS } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { kbAnswer } from '../lib/ai.js';

const router = Router();
router.use(auth, roles(...STAFF));

/** 1i — knowledge base. One brain: staff search, inbox drafts, website chatbot. */
router.get('/', async (req, res) => {
  const { data } = await db.from('documents')
    .select('id,title,category,file_url,client_id,property_id,created_at,uploader:uploaded_by(name), content_text')
    .order('created_at', { ascending: false });
  res.json((data || []).map((d) => ({ ...d, excerpt: d.content_text?.slice(0, 160) || null, content_text: undefined })));
});

/** Upload once — text content becomes searchable and powers all three AI surfaces. */
router.post('/', async (req, res) => {
  const { title, category, content_text, file_url, client_id, property_id } = req.body || {};
  if (!title || !category) return res.status(400).json({ error: 'title and category required' });
  const { data, error } = await db.from('documents').insert({
    title, category, content_text: content_text || null, file_url: file_url || null,
    client_id: client_id || null, property_id: property_id || null, uploaded_by: req.user.id,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  await audit(req.user, 'uploaded', 'document', data.id, { title, category });
  res.json(data);
});

router.delete('/:id', roles(...MANAGERS), async (req, res) => {
  await db.from('documents').delete().eq('id', req.params.id);
  await audit(req.user, 'deleted', 'document', req.params.id, {});
  res.json({ ok: true });
});

/** Ask-anything — answers with the source document cited. */
router.post('/ask', async (req, res) => {
  const { question } = req.body || {};
  if (!question?.trim()) return res.status(400).json({ error: 'question required' });
  const result = await kbAnswer(question.trim());
  res.json(result);
});

export default router;
