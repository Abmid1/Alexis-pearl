import { Router } from 'express';
import { auth, roles, MANAGERS } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { listingCopy } from '../lib/ai.js';
import { sendMessage } from '../lib/integrations.js';
import { cleanListingInput } from '../lib/listing.js';

const router = Router();
router.use(auth, roles('owner', 'admin', 'marketing', 'agent'));

/** 1e — attribution: per platform → spend, leads, deals closed. Built from source tags. */
router.get('/attribution', async (req, res) => {
  const [{ data: campaigns }, { data: leads }, { data: deals }] = await Promise.all([
    req.tdb.from('campaigns').select('*'),
    req.tdb.from('leads').select('id,source,campaign_id,stage'),
    req.tdb.from('deals').select('id,lead_id,sale_price,status'),
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
  const { data, error } = await req.tdb.from('campaigns').insert({ platform, name, spend: spend || 0, started_on: started_on || new Date().toISOString().slice(0, 10) }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  await audit(req.user, 'created', 'campaign', data.id, { platform, name });
  res.json(data);
});

/** Listings — AI drafts the copy; Owner/Admin approves before publish. */
router.get('/listings', async (req, res) => {
  const { data } = await req.tdb.from('properties').select('*').is('archived_at', null).order('created_at', { ascending: false });
  res.json(data || []);
});

router.post('/listings', roles('owner', 'admin', 'marketing'), async (req, res) => {
  const { patch, errors } = cleanListingInput(req.body || {});
  if (errors.length) return res.status(400).json({ error: errors.join(', ') });
  const { data, error } = await req.tdb.from('properties').insert({
    ptype: 'sale', ...patch, listing_status: 'draft', updated_at: new Date().toISOString(),
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  await audit(req.user, 'created', 'property', data.id, { title: data.title });
  res.json(data);
});

/**
 * Edit a listing. Published listings update live on the public site immediately.
 * Changing availability stamps availability_confirmed_at (staff are the source of truth).
 */
router.patch('/listings/:id', roles('owner', 'admin', 'marketing'), async (req, res) => {
  const { data: prop } = await req.tdb.from('properties').select('id,title,availability').eq('id', req.params.id).maybeSingle();
  if (!prop) return res.status(404).json({ error: 'Property not found' });
  const { patch, errors } = cleanListingInput(req.body || {}, { partial: true });
  if (errors.length) return res.status(400).json({ error: errors.join(', ') });
  if ('title' in patch && !patch.title) return res.status(400).json({ error: 'title cannot be empty' });
  if (req.body?.confirm_availability || ('availability' in patch)) patch.availability_confirmed_at = new Date().toISOString();
  patch.updated_at = new Date().toISOString();
  const { data, error } = await req.tdb.from('properties').update(patch).eq('id', prop.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  await audit(req.user, 'updated', 'property', prop.id, { title: data.title, changes: Object.keys(patch) });
  res.json(data);
});

/** AI listing description — Use it / Regenerate loop. */
router.post('/listings/:id/generate-copy', async (req, res) => {
  const { data: prop } = await req.tdb.from('properties').select('*').eq('id', req.params.id).maybeSingle();
  if (!prop) return res.status(404).json({ error: 'Property not found' });
  const copy = await listingCopy(prop);
  res.json({ copy });
});

router.post('/listings/:id/use-copy', roles('owner', 'admin', 'marketing'), async (req, res) => {
  const { copy } = req.body || {};
  if (!copy) return res.status(400).json({ error: 'copy required' });
  const { data, error } = await req.tdb.from('properties')
    .update({ description: String(copy).slice(0, 8000), listing_status: 'pending_approval', updated_at: new Date().toISOString() })
    .eq('id', req.params.id).select().maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Property not found' });
  await audit(req.user, 'submitted_listing', 'property', data.id, { title: data.title });
  res.json(data);
});

/** Submit a listing for approval without AI copy. */
router.post('/listings/:id/submit', roles('owner', 'admin', 'marketing'), async (req, res) => {
  const { data, error } = await req.tdb.from('properties')
    .update({ listing_status: 'pending_approval', updated_at: new Date().toISOString() })
    .eq('id', req.params.id).in('listing_status', ['draft', 'rejected']).select().maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Listing not found or not in draft' });
  await audit(req.user, 'submitted_listing', 'property', data.id, { title: data.title });
  res.json(data);
});

/** Owner/Admin approves → published (appears on the company website). */
router.post('/listings/:id/approve', roles(...MANAGERS), async (req, res) => {
  const now = new Date().toISOString();
  const { data, error } = await req.tdb.from('properties')
    .update({ listing_status: 'published', published_at: now, availability_confirmed_at: now, updated_at: now })
    .eq('id', req.params.id).select().maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Property not found' });
  await audit(req.user, 'approved', 'listing', data.id, { title: data.title });
  res.json(data);
});

router.post('/listings/:id/reject', roles(...MANAGERS), async (req, res) => {
  const { data, error } = await req.tdb.from('properties').update({ listing_status: 'rejected', updated_at: new Date().toISOString() }).eq('id', req.params.id).select().maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Property not found' });
  await audit(req.user, 'rejected', 'listing', data.id, { title: data.title });
  res.json(data);
});

/** Unpublish → back to draft; disappears from the public site and search immediately. */
router.post('/listings/:id/unpublish', roles(...MANAGERS), async (req, res) => {
  const { data, error } = await req.tdb.from('properties').update({ listing_status: 'draft', updated_at: new Date().toISOString() }).eq('id', req.params.id).select().maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Property not found' });
  await audit(req.user, 'unpublished', 'listing', data.id, { title: data.title });
  res.json(data);
});

/** Archive — hidden everywhere public and from the active listings board; record kept. */
router.post('/listings/:id/archive', roles(...MANAGERS), async (req, res) => {
  const { data, error } = await req.tdb.from('properties').update({ archived_at: new Date().toISOString(), listing_status: 'draft' }).eq('id', req.params.id).select().maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Property not found' });
  await audit(req.user, 'archived', 'listing', data.id, { title: data.title });
  res.json(data);
});

/** Bulk campaign send (WhatsApp/SMS/email) to leads — through the integration seam. */
router.post('/broadcast', roles('owner', 'admin', 'marketing'), async (req, res) => {
  const { channel, message, stage } = req.body || {};
  if (!channel || !message) return res.status(400).json({ error: 'channel and message required' });
  let q = req.tdb.from('leads').select('id,name,phone,email');
  if (stage && stage !== 'all') q = q.eq('stage', stage);
  const { data: leads } = await q;
  let sent = 0;
  for (const l of leads || []) {
    const addr = channel === 'email' ? l.email : l.phone;
    if (!addr) continue;
    await sendMessage(channel, addr, message.replaceAll('{name}', l.name), 'campaign', { companyId: req.user.company_id });
    sent++;
  }
  await audit(req.user, 'broadcast', 'campaign', null, { channel, recipients: sent });
  res.json({ sent });
});

export default router;
