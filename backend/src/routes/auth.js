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

export default router;
