import { Router } from 'express';
import { db } from '../db.js';
import { auth, roles, STAFF, MANAGERS } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { DEFAULT_HOURS } from '../lib/scheduling.js';

/** The signed-in user's company: public website + branding settings. */
const router = Router();
router.use(auth, roles(...STAFF));

const PUBLIC_FIELDS = 'id,slug,name,custom_domain,public_enabled,logo_url,brand_color,tagline,about,contact_phone,contact_email,whatsapp,address,office_hours,socials,services,viewing_hours';
const SERVICES = ['buy', 'rent', 'sell', 'land', 'management', 'valuation'];
const SOCIALS = ['instagram', 'facebook', 'tiktok', 'x', 'linkedin', 'youtube', 'website'];

router.get('/', async (req, res) => {
  const { data } = await db.from('companies').select(PUBLIC_FIELDS).eq('id', req.user.company_id).single();
  res.json(data);
});

const text = (v, n) => (v == null || v === '' ? null : String(v).trim().slice(0, n));
const httpsUrl = (v) => (v == null || v === '' ? null : /^https:\/\/[^\s"'<>]{3,500}$/i.test(String(v).trim()) ? String(v).trim() : undefined);

/** Owners/admins edit branding, contact details, services and the viewing schedule. */
router.patch('/', roles(...MANAGERS), async (req, res) => {
  const b = req.body || {};
  const patch = {}; const errors = [];
  for (const [k, n] of [['name', 120], ['tagline', 160], ['about', 4000], ['contact_phone', 32], ['contact_email', 254], ['whatsapp', 32], ['address', 300], ['office_hours', 120]]) {
    if (k in b) patch[k] = text(b[k], n);
  }
  if ('name' in patch && !patch.name) errors.push('Company name is required');
  if ('logo_url' in b) { const u = httpsUrl(b.logo_url); if (u === undefined) errors.push('Logo must be an https:// link'); else patch.logo_url = u; }
  if ('brand_color' in b) { if (!/^#[0-9A-Fa-f]{6}$/.test(String(b.brand_color))) errors.push('Brand colour must look like #4038B8'); else patch.brand_color = b.brand_color; }
  if ('public_enabled' in b) patch.public_enabled = !!b.public_enabled;
  if ('services' in b) patch.services = (Array.isArray(b.services) ? b.services : []).filter((s) => SERVICES.includes(s));
  if ('socials' in b) {
    const out = {};
    for (const k of SOCIALS) { const u = httpsUrl(b.socials?.[k]); if (u === undefined) errors.push(`${k} must be an https:// link`); else if (u) out[k] = u; }
    patch.socials = out;
  }
  if ('viewing_hours' in b) {
    const h = { ...DEFAULT_HOURS, ...(b.viewing_hours || {}) };
    const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (!hhmm.test(h.start) || !hhmm.test(h.end) || h.end <= h.start) errors.push('Viewing hours must be HH:MM with end after start');
    const days = (Array.isArray(h.days) ? h.days : []).map(Number).filter((d) => d >= 0 && d <= 6);
    patch.viewing_hours = {
      days: [...new Set(days)].sort(), start: h.start, end: h.end,
      slot_minutes: Math.max(15, Math.min(240, Number(h.slot_minutes) || 45)),
      min_notice_hours: Math.max(0, Math.min(168, Number(h.min_notice_hours) || 0)),
      max_days_ahead: Math.max(1, Math.min(60, Number(h.max_days_ahead) || 21)),
      cancel_cutoff_hours: Math.max(0, Math.min(72, Number(h.cancel_cutoff_hours) || 0)),
    };
  }
  if ('slug' in b) {
    if (req.user.role !== 'owner') errors.push('Only the owner can change the website address');
    else if (!/^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])$/.test(String(b.slug))) errors.push('Address must be 3–40 lowercase letters, numbers or dashes');
    else if (['app', 'www', 'api', 'admin', 'portal', 'login', 'static', 'assets'].includes(b.slug)) errors.push('That address is reserved');
    else patch.slug = b.slug;
  }
  if (errors.length) return res.status(400).json({ error: errors.join('. ') });
  const { data, error } = await db.from('companies').update(patch).eq('id', req.user.company_id).select(PUBLIC_FIELDS).single();
  if (error) return res.status(error.code === '23505' ? 409 : 500).json({ error: error.code === '23505' ? 'That website address is taken' : error.message });
  await audit(req.user, 'updated', 'company', req.user.company_id, { changes: Object.keys(patch) });
  res.json(data);
});

export default router;
