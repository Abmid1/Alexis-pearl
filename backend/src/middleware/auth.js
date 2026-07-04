import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET || 'dev_secret';

export function signToken(user) {
  return jwt.sign(
    { id: user.id, name: user.name, role: user.role, email: user.email },
    SECRET,
    { expiresIn: '30d' }
  );
}

/** Require a valid JWT. Attaches req.user = { id, name, role, email }. */
export function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/** Role guard: roles('owner','admin') — matches the permission grid in the spec. */
export function roles(...allowed) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    if (!allowed.includes(req.user.role)) {
      return res.status(403).json({ error: `Requires role: ${allowed.join(' or ')}` });
    }
    next();
  };
}

export const STAFF = ['owner', 'admin', 'agent', 'marketing'];
export const MANAGERS = ['owner', 'admin'];
