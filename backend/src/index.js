import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cron from 'node-cron';

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

import { db } from './db.js';
import { sendMessage } from './lib/integrations.js';
import { sendWeeklyReport } from './lib/weekly.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '15mb' })); // receipt photos travel as data URLs

app.get('/', (_, res) => res.json({ ok: true, service: 'alexis-pearl-backend' }));

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
app.use('/api', miscRoutes);

// ── Cron: payment reminders daily 8am, overdue invoice sweep, Monday digest ──
cron.schedule('0 8 * * *', async () => {
  try {
    const cutoff = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    const { data: due } = await db.from('installments')
      .select('*, plan:plan_id(client:client_id(name,phone))')
      .eq('status', 'pending').eq('reminder_sent', false).lte('due_date', cutoff);
    for (const i of due || []) {
      const c = i.plan?.client;
      if (!c?.phone) continue;
      await sendMessage('whatsapp', c.phone,
        `Hello ${c.name}, a friendly reminder from Alexis Pearl: your installment of GHS ${Number(i.amount).toLocaleString()} is due on ${i.due_date}. You can pay in the client portal or reply here for help.`,
        'reminder');
      await db.from('installments').update({ reminder_sent: true }).eq('id', i.id);
    }
    // flip overdue statuses
    const today = new Date().toISOString().slice(0, 10);
    await db.from('installments').update({ status: 'overdue' }).eq('status', 'pending').lt('due_date', today);
    await db.from('invoices').update({ status: 'overdue' }).eq('status', 'pending').lt('due_date', today);
  } catch (e) { console.error('daily cron:', e.message); }
});

cron.schedule('0 7 * * 1', async () => {           // Monday 7am — the digest sends itself
  try { await sendWeeklyReport(); } catch (e) { console.error('weekly report cron:', e.message); }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Alexis Pearl backend on :${PORT}`));
