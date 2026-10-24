/**
 * Small in-memory fixed-window rate limiter for public endpoints.
 * No extra dependency. Limits are per process: with several backend instances,
 * each keeps its own counters (move to Redis/Upstash if you scale out).
 */
const buckets = new Map();

export function clientIp(req) {
  // Render/Vercel sit behind a proxy; app.set('trust proxy', 1) makes req.ip the real client.
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

export function rateLimit({ name, windowMs, max, key = clientIp }) {
  return (req, res, next) => {
    const k = `${name}:${key(req)}`;
    const now = Date.now();
    let b = buckets.get(k);
    if (!b || b.reset <= now) { b = { count: 0, reset: now + windowMs }; buckets.set(k, b); }
    b.count++;
    if (b.count > max) {
      res.set('Retry-After', String(Math.ceil((b.reset - now) / 1000)));
      return res.status(429).json({ error: 'Too many requests — please wait a moment and try again.' });
    }
    next();
  };
}

/** Test helper. */
export function resetRateLimits() { buckets.clear(); }

// sweep expired buckets so memory stays bounded
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (b.reset <= now) buckets.delete(k);
}, 60000).unref();
