import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { db } from '../db.js';
import { signToken, auth } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';

const router = Router();

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  const { data: user } = await db.from('users').select('*').eq('email', email.toLowerCase().trim()).single();
  if (!user || !user.active) return res.status(401).json({ error: 'Invalid credentials' });
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
  await audit(user, 'logged_in', 'session', user.id);
  res.json({ token: signToken(user), user: { id: user.id, name: user.name, role: user.role, email: user.email } });
});

router.get('/me', auth, async (req, res) => {
  res.json({ user: req.user });
});

router.post('/change-password', auth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'currentPassword and newPassword required' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });
  const { data: user } = await db.from('users').select('*').eq('id', req.user.id).single();
  if (!user) return res.status(401).json({ error: 'Invalid session' });
  const ok = await bcrypt.compare(currentPassword, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Current password is incorrect' });
  const { error } = await db.from('users').update({ password_hash: await bcrypt.hash(newPassword, 10) }).eq('id', user.id);
  if (error) return res.status(500).json({ error: error.message });
  await audit(user, 'changed_password', 'user', user.id);
  res.json({ ok: true });
});

export default router;
