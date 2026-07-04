import { Router } from 'express';
import { db } from '../db.js';
import { auth, roles, STAFF } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { compileWeeklyReport, sendWeeklyReport } from '../lib/weekly.js';

const router = Router();
router.use(auth, roles(...STAFF));

/** 1h — live report (compiles itself from data; agents see own performance). */
router.get('/', async (req, res) => {
  const report = await compileWeeklyReport();
  if (req.user.role === 'agent') {
    // agents: own performance only
    report.leaderboard = report.leaderboard.filter((r) => r.agentId === req.user.id);
  }
  res.json(report);
});

/** History of auto-sent Monday digests. */
router.get('/history', async (req, res) => {
  const { data } = await db.from('report_runs').select('*').order('created_at', { ascending: false }).limit(12);
  res.json(data || []);
});

/** Send the weekly digest now (same job the Monday cron runs). */
router.post('/send-now', roles('owner', 'admin'), async (req, res) => {
  const run = await sendWeeklyReport();
  await audit(req.user, 'sent', 'report', run.id, { week_start: run.week_start });
  res.json(run);
});

export default router;
