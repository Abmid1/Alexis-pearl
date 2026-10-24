import express from 'express';
import cors from 'cors';
import Layer from 'express/lib/router/layer.js';

import authRoutes from './routes/auth.js';
import dashboardRoutes from './routes/dashboard.js';
import leadRoutes from './routes/leads.js';
import dealRoutes from './routes/deals.js';
import inboxRoutes from './routes/inbox.js';
import marketingRoutes from './routes/marketing.js';
import financeRoutes from './routes/finance.js';
import planRoutes from './routes/plans.js';
import reportRoutes from './routes/reports.js';
import kbRoutes from './routes/kb.js';
import pmRoutes from './routes/pm.js';
import portalRoutes from './routes/portal.js';
import webhookRoutes from './routes/webhooks.js';
import miscRoutes from './routes/misc.js';
import publicRoutes from './routes/public.js';
import viewingRoutes from './routes/viewings.js';
import enquiryRoutes from './routes/enquiries.js';
import companyRoutes from './routes/company.js';

// Express 4 does not catch rejected promises from async handlers; route them to the
// error handler instead of leaving the request hanging (same idea as express-async-errors).
const handle = Layer.prototype.handle_request;
Layer.prototype.handle_request = function (req, res, next) {
  if (this.handle.length > 3) return handle.call(this, req, res, next);
  try {
    const r = this.handle(req, res, next);
    if (r && typeof r.catch === 'function') r.catch(next);
  } catch (e) { next(e); }
};

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);           // Render/Vercel proxy → real client IP for rate limiting
  app.disable('x-powered-by');
  app.use(cors());                     // JWT travels in a header, not cookies, so open CORS adds no CSRF risk
  app.use(express.json({
    limit: '15mb',                     // receipt photos travel as data URLs
    verify: (req, _res, buf) => { if (req.originalUrl.startsWith('/api/webhooks')) req.rawBody = buf; },
  }));
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  // Safe errors: never leak database messages in production; "no rows" becomes 404.
  app.use((req, res, next) => {
    const json = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode >= 500 && body && typeof body.error === 'string') {
        if (/JSON object requested|multiple \(or no\) rows/i.test(body.error)) { res.status(404); return json({ error: 'Not found' }); }
        console.error(`[${req.method} ${req.originalUrl}]`, body.error);
        if (process.env.NODE_ENV === 'production') return json({ error: 'Something went wrong. Please try again.' });
      }
      return json(body);
    };
    next();
  });

  app.get('/', (_, res) => res.json({ ok: true, service: 'bilt-africa-backend' }));

  app.use('/api/auth', authRoutes);
  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api/leads', leadRoutes);
  app.use('/api/deals', dealRoutes);
  app.use('/api/inbox', inboxRoutes);
  app.use('/api/marketing', marketingRoutes);
  app.use('/api/finance', financeRoutes);
  app.use('/api/plans', planRoutes);
  app.use('/api/reports', reportRoutes);
  app.use('/api/kb', kbRoutes);
  app.use('/api/pm', pmRoutes);
  app.use('/api/portal', portalRoutes);
  app.use('/api/webhooks', webhookRoutes);
  app.use('/api/public/:slug', publicRoutes);
  app.use('/api/viewings', viewingRoutes);
  app.use('/api/enquiries', enquiryRoutes);
  app.use('/api/company', companyRoutes);
  app.use('/api', miscRoutes);

  app.use((req, res) => res.status(404).json({ error: 'Not found' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Request too large' });
    console.error(`[${req.method} ${req.originalUrl}]`, err);
    res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Something went wrong. Please try again.' : String(err?.message || err) });
  });
  return app;
}
