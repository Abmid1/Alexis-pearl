import 'dotenv/config';
import cron from 'node-cron';

import { createApp } from './app.js';
import { db } from './db.js';
import { sendWeeklyReport } from './lib/weekly.js';
import { sendInstallmentReminders } from './routes/plans.js';

const app = createApp();

/** Background jobs run once per company so data never crosses tenants. */
async function eachCompany(fn, label) {
  const { data: companies } = await db.from('companies').select('id,slug');
  for (const c of companies || []) {
    try { await fn(c.id); } catch (e) { console.error(`${label} [${c.slug}]:`, e.message); }
  }
}

// ── Cron: payment reminders daily 8am, overdue sweep, Monday digest ──
cron.schedule('0 8 * * *', async () => {
  await eachCompany((id) => sendInstallmentReminders(id, 3), 'daily reminders');
  try {
    // flip overdue statuses (status-only change, safe across companies)
    const today = new Date().toISOString().slice(0, 10);
    await db.from('installments').update({ status: 'overdue' }).eq('status', 'pending').lt('due_date', today);
    await db.from('invoices').update({ status: 'overdue' }).eq('status', 'pending').lt('due_date', today);
  } catch (e) { console.error('daily cron:', e.message); }
}, { timezone: 'Africa/Accra' });

cron.schedule('0 7 * * 1', () => eachCompany(sendWeeklyReport, 'weekly report'), { timezone: 'Africa/Accra' });

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Bilt Africa backend on :${PORT}`));
