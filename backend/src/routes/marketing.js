import { Router } from 'express';
import { db } from '../db.js';
import { auth, roles, MANAGERS } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { listingCopy } from '../lib/ai.js';
import { sendMessage } from '../lib/integrations.js';

const router = Router();
router.use(auth, roles('owner', 'admin', 'marketing', 'agent'));

/** 1e — attribution: per platform → spend, leads, deals closed. Built from source tags. */
router.get('/attribution', async (req, res) => {
  const [{ data: campaigns }, { data: leads }, { data: deals }] = await Promise.all([
    db.from('campaigns').select('*'),
    db.from('leads').select('id,source,campaign_id,stage'),
    db.from('deals').select('id,lead_id,sale_price,status'),
  ]);
  const dealByLead = {};
  (deals || []).forEach((d) => { if (d.lead_id) dealByLead[d.lead_id] = d; });

  const platforms = {};
  (leads || []).forEach((l) => {
    const p = l.source;
    platforms[p] = platforms[p] || { platform: p, spend: 0, leads: 0, dealsClosed: 0, revenue: 0 };
    platforms[p].leads++;
    const deal = dealByLead[l.id];
    if (deal && ['approved', 'closed'].includes(deal.status)) {
      platforms[p].dealsClosed++;
      platforms[p].revenue += Number(deal.sale_price);
    }
  });
  (campaigns || []).forEach((c) => {
    const key = c.platform;
    platforms[key] = platforms[key] || { platform: key, spend: 0, leads: 0, dealsClosed: 0, revenue: 0 };
    platforms[key].spend += Number(c.spend);
  });
  res.json({ rows: Object.values(platforms).sort((a, b) => b.leads - a.leads), campaigns: campaigns || [] });
});

router.post('/campaigns', roles('owner', 'admin', 'marketing'), async (req, res) => {
  const { platform, name, spend, started_on } = req.body || {};
  if (!platform || !name) return res.status(400).json({ error: 'platform and name required' });
  const { data, error } = await db.from('campaigns').insert({ platform, name, spend: spend || 0, started_on: started_on || new Date().toISOString().slice(0, 10) }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  await audit(req.user, 'created', 'campaign', data.id, { platform, name });
  res.json(data);
});

/** Listings — AI drafts the copy; Owner/Admin approves before publish. */
router.get('/listings', async (req, res) => {
  const { data } = await db.from('properties').select('*').order('created_at', { ascending: false });
  res.json(data || []);
});

router.post('/listings', roles('owner', 'admin', 'marketing'), async (req, res) => {
  const { title, location, price, ptype, description, lat, lng } = req.body || {};
  if (!title || !price) return res.status(400).json({ error: 'title and price required' });
  const { data, error } = await db.from('properties').insert({
    title, location, price, ptype: ptype || 'sale', description, lat: lat || null, lng: lng || null,
    listing_status: 'draft',
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  await audit(req.user, 'created', 'property', data.id, { title });
  res.json(data);
});

/** AI listing description — Use it / Regenerate loop. */
router.post('/listings/:id/generate-copy', async (req, res) => {
  const { data: prop } = await db.from('properties').select('*').eq('id', req.params.id).single();
  if (!prop) return res.status(404).json({ error: 'Property not found' });
  const copy = await listingCopy(prop);
  res.json({ copy });
});

router.post('/listings/:id/use-copy', roles('owner', 'admin', 'marketing'), async (req, res) => {
  const { copy } = req.body || {};
  if (!copy) return res.status(400).json({ error: 'copy required' });
  const { data, error } = await db.from('properties')
    .update({ description: copy, listing_status: 'pending_approval' })
    .eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  await audit(req.user, 'submitted_listing', 'property', data.id, { title: data.title });
  res.json(data);
});

/** Owner/Admin approves → published. */
router.post('/listings/:id/approve', roles(...MANAGERS), async (req, res) => {
  const { data, error } = await db.from('properties').update({ listing_status: 'published' }).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  await audit(req.user, 'approved', 'listing', data.id, { title: data.title });
  res.json(data);
});

router.post('/listings/:id/reject', roles(...MANAGERS), async (req, res) => {
  const { data, error } = await db.from('properties').update({ listing_status: 'rejected' }).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  await audit(req.user, 'rejected', 'listing', data.id, { title: data.title });
  res.json(data);
});

/** Bulk campaign send (WhatsApp/SMS/email) to leads — through the integration seam. */
router.post('/broadcast', roles('owner', 'admin', 'marketing'), async (req, res) => {
  const { channel, message, stage } = req.body || {};
  if (!channel || !message) return res.status(400).json({ error: 'channel and message required' });
  let q = db.from('leads').select('id,name,phone,email');
  if (stage && stage !== 'all') q = q.eq('stage', stage);
  const { data: leads } = await q;
  let sent = 0;
  for (const l of leads || []) {
    const addr = channel === 'email' ? l.email : l.phone;
    if (!addr) continue;
    await sendMessage(channel, addr, message.replaceAll('{name}', l.name), 'campaign');
    sent++;
  }
  await audit(req.user, 'broadcast', 'campaign', null, { channel, recipients: sent });
  res.json({ sent });
});

export default router;
