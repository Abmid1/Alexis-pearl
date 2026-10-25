import jwt from 'jsonwebtoken';
import { tenantDb } from '../lib/tenant.js';

const SECRET = process.env.JWT_SECRET || 'dev_secret';
if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
  console.error('JWT_SECRET must be set in production.');
  process.exit(1);
}

export function signToken(user) {
  return jwt.sign(
    { id: user.id, name: user.name, role: user.role, email: user.email, company_id: user.company_id },
    SECRET,
    { expiresIn: '30d' }
  );
}

/**
 * Require a valid JWT. Attaches req.user = { id, name, role, email, company_id }
 * and req.tdb — a database handle locked to the user's company.
 * Tokens issued before multi-company support carry no company_id and must re-login.
 */
export function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    req.user = jwt.verify(token, SECRET);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  // customer website sessions are never valid for the workspace
  if (req.user.kind === 'customer' || req.user.aud === 'customer') return res.status(401).json({ error: 'Not authenticated' });
  if (!req.user.company_id) return res.status(401).json({ error: 'Session expired — please sign in again' });
  req.tdb = tenantDb(req.user.company_id);
  next();
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
