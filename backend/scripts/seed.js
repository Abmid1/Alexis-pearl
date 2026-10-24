import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { tenantDb } from '../src/lib/tenant.js';
import { db } from '../src/db.js';
import { pathToFileURL } from 'node:url';

const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();
const daysAhead = (n) => new Date(Date.now() + n * 86400000).toISOString();
const dAhead = (n) => daysAhead(n).slice(0, 10);
const dAgo = (n) => daysAgo(n).slice(0, 10);

export async function run() {
  console.log('Seeding Alexis Pearl…');
  const hash = await bcrypt.hash('demo1234', 10);

  // ── Companies (run migrations/001 first). Every record below is stamped with its company. ──
  const { data: AP, error: cerr } = await db.from('companies').upsert({
    slug: 'alexis-pearl', name: 'Alexis Pearl', tagline: 'Homes and land across Greater Accra',
    about: 'Alexis Pearl helps families, diaspora buyers and investors buy, rent and build in Greater Accra — from gated townhouses in East Legon to furnished rentals in Osu.',
    contact_phone: '+233244000001', contact_email: 'hello@alexispearl.com', whatsapp: '+233244000001',
    address: 'East Legon, Accra', office_hours: 'Mon–Sat, 8:30am–5pm', brand_color: '#4038B8',
    services: ['buy', 'rent', 'land', 'management'],
  }, { onConflict: 'slug' }).select().single();
  if (cerr) throw new Error(`companies table missing — run scripts/migrations/001_multi_company_public_site.sql first (${cerr.message})`);
  const ap = tenantDb(AP.id, db);

  // ── Staff: 4 people, one office, Accra ────────────────────────────
  const { data: users, error: uerr } = await ap.from('users').insert([
    { name: 'Alexis Owusu',   email: 'owner@alexispearl.com', phone: '+233244000001', role: 'owner',     password_hash: hash },
    { name: 'Adjoa Baah',     email: 'admin@alexispearl.com', phone: '+233244000002', role: 'admin',     password_hash: hash },
    { name: 'Kojo Antwi',     email: 'kojo@alexispearl.com',  phone: '+233244000003', role: 'agent',     password_hash: hash },
    { name: 'Efua Danso',     email: 'efua@alexispearl.com',  phone: '+233244000004', role: 'agent',     password_hash: hash },
  ]).select();
  if (uerr) throw uerr;
  const [owner, admin, kojo, efua] = users;

  // ── Clients ───────────────────────────────────────────────────────
  const { data: clients } = await ap.from('clients').insert([
    { name: 'Nana Adjei',      phone: '+233201111111', email: 'nana.adjei@gmail.com' },
    { name: 'Akosua Frimpong', phone: '+233202222222', email: 'akosua.f@gmail.com' },
    { name: 'Yaw Mensah',      phone: '+233203333333', email: 'yaw.mensah@yahoo.com' },
    { name: 'Abena Sarpong',   phone: '+233204444444', email: 'abena.sarpong@gmail.com' },
  ]).select();
  const [nana, akosua, yaw, abena] = clients;

  // portal login for Nana (client demo)
  const { data: nanaUser } = await ap.from('users').insert({
    name: 'Nana Adjei', email: 'client@alexispearl.com', role: 'client', password_hash: hash,
  }).select().single();
  await ap.from('clients').update({ user_id: nanaUser.id }).eq('id', nana.id);

  // ── Campaigns ─────────────────────────────────────────────────────
  const { data: campaigns } = await ap.from('campaigns').insert([
    { platform: 'TikTok',    name: 'East Legon Hills promo', spend: 1200, started_on: dAgo(30) },
    { platform: 'Instagram', name: 'Airport Residential reel', spend: 800, started_on: dAgo(21) },
  ]).select();

  // ── Properties + units ────────────────────────────────────────────
  const { data: props } = await ap.from('properties').insert([
    { title: '3-bed townhouse · East Legon Hills', location: 'East Legon Hills, Accra', lat: 5.665, lng: -0.125, price: 850000,  ptype: 'development', listing_status: 'published', description: 'Modern 3-bedroom townhouse in a gated community with 24/7 security, backup power and a communal pool.', property_type: 'townhouse', neighbourhood: 'East Legon Hills', city: 'Accra', region: 'Greater Accra', bedrooms: 3, bathrooms: 3, size_sqm: 210, furnishing: 'unfurnished', amenities: ['security', 'gated', 'backup_power', 'borehole', 'pool', 'gym', 'parking', 'garden'], featured: true, published_at: daysAgo(40) },
    { title: '2-bed apartment · Airport Residential', location: 'Airport Residential, Accra', lat: 5.605, lng: -0.180, price: 650000, ptype: 'sale', listing_status: 'published', description: 'Fully fitted 2-bed apartment, 5 minutes from Kotoka International Airport.', property_type: 'apartment', neighbourhood: 'Airport Residential', city: 'Accra', region: 'Greater Accra', bedrooms: 2, bathrooms: 2, furnishing: 'semi_furnished', amenities: ['fitted_kitchen', 'air_conditioning', 'parking', 'security', 'elevator'], published_at: daysAgo(20) },
    { title: '4-bed house · Tema Community 25', location: 'Tema C25', lat: 5.700, lng: -0.020, price: 1200000, ptype: 'sale', listing_status: 'pending_approval', description: 'Spacious family home with a boys’ quarters and 2-car garage.', property_type: 'house', neighbourhood: 'Community 25', city: 'Tema', region: 'Greater Accra', bedrooms: 4, bathrooms: 4, amenities: ['boys_quarters', 'parking', 'garden'] },
    { title: '2-bed apartment · Osu (rental)', location: 'Osu, Accra', lat: 5.557, lng: -0.174, price: 4500, ptype: 'rent', listing_status: 'published', description: 'Furnished 2-bed near Oxford Street. Rent is monthly.', managed: true, property_type: 'apartment', neighbourhood: 'Osu', city: 'Accra', region: 'Greater Accra', bedrooms: 2, bathrooms: 1, furnishing: 'furnished', rent_period: 'month', advance_months: 12, availability: 'rented', amenities: ['air_conditioning', 'internet', 'water_storage', 'prepaid_meter'], published_at: daysAgo(90) },
  ]).select();
  const [eastLegon, airport, tema, osu] = props;

  const { data: units } = await ap.from('units').insert([
    { property_id: eastLegon.id, name: 'Unit 7', client_id: nana.id, completion_pct: 65, handover_date: dAhead(150) },
    { property_id: eastLegon.id, name: 'Unit 12', completion_pct: 40, handover_date: dAhead(210) },
    { property_id: osu.id, name: 'Apt 2B', client_id: abena.id, completion_pct: 100 },
  ]).select();
  const [unit7, , apt2b] = units;

  // ── Leads across the kanban ───────────────────────────────────────
  const { data: leads } = await ap.from('leads').insert([
    { name: 'Kwabena Osei',   phone: '+233205555555', source: 'WhatsApp',  stage: 'new',       owner_id: kojo.id, interest: '2-bed Airport Residential', budget: 700000, next_follow_up: daysAhead(1), created_at: daysAgo(2) },
    { name: 'Ama Serwaa',     phone: '+233206666666', source: 'TikTok',    stage: 'contacted', owner_id: efua.id, interest: 'East Legon townhouse', budget: 900000, campaign_id: campaigns[0].id, next_follow_up: daysAgo(1), created_at: daysAgo(6) },      // OVERDUE
    { name: 'Kofi Boakye',    phone: '+233207777777', source: 'Referral',  stage: 'viewing',   owner_id: kojo.id, interest: 'Tema family house', budget: 1300000, next_follow_up: daysAhead(2), created_at: daysAgo(10) },
    { name: 'Esi Nyarko',     phone: '+233208888888', source: 'Instagram', stage: 'closing',   owner_id: efua.id, interest: 'East Legon Unit 12', budget: 850000, campaign_id: campaigns[1].id, next_follow_up: daysAhead(1), created_at: daysAgo(18) },
    { name: 'Nana Adjei',     phone: '+233201111111', source: 'Call-in',   stage: 'won',       owner_id: kojo.id, interest: 'East Legon Unit 7', budget: 850000, client_id: nana.id, created_at: daysAgo(60) },
    { name: 'Kwesi Appiah',   phone: '+233209999999', source: 'Walk-in',   stage: 'contacted', owner_id: kojo.id, interest: 'Land in Oyarifa', budget: 200000, next_follow_up: daysAgo(2), created_at: daysAgo(12), updated_at: daysAgo(9) },              // OVERDUE + going cold
  ]).select();
  const [kwabena, ama, kofiB, esi, nanaLead] = leads;

  // ── Deals ─────────────────────────────────────────────────────────
  const { data: deals } = await ap.from('deals').insert([
    { title: 'Unit 7 · East Legon Hills — Nana Adjei', lead_id: nanaLead.id, client_id: nana.id, property_id: eastLegon.id, agent_id: kojo.id, sale_price: 850000, commission_rate: 5, status: 'approved', approved_by: owner.id, created_at: daysAgo(55) },
    { title: 'Unit 12 · East Legon Hills — Esi Nyarko', lead_id: esi.id, property_id: eastLegon.id, agent_id: efua.id, sale_price: 830000, commission_rate: 5, status: 'pending_approval', created_at: daysAgo(3) },
  ]).select();
  const [nanaDeal, esiDeal] = deals;

  await db.from('commission_splits').insert([
    { deal_id: nanaDeal.id, user_id: kojo.id, pct: 60, amount: 25500 },
    { deal_id: nanaDeal.id, user_id: efua.id, pct: 40, amount: 17000 },
    { deal_id: esiDeal.id,  user_id: efua.id, pct: 100, amount: 41500 },
  ]);

  // ── Payment plan: Nana, 18 installments, 6 paid ───────────────────
  const { data: plan } = await ap.from('payment_plans').insert({
    deal_id: nanaDeal.id, client_id: nana.id, unit_id: unit7.id,
    total: 850000, installment_count: 18, start_date: dAgo(180),
  }).select().single();

  const per = +(850000 / 18).toFixed(2);
  const instRows = Array.from({ length: 18 }, (_, i) => {
    const due = new Date(Date.now() - 180 * 86400000); due.setMonth(due.getMonth() + i);
    const isPaid = i < 6;
    return {
      plan_id: plan.id, seq: i + 1, due_date: due.toISOString().slice(0, 10),
      amount: i === 17 ? +(850000 - per * 17).toFixed(2) : per,
      status: isPaid ? 'paid' : (due < new Date() ? 'overdue' : 'pending'),
      paid_at: isPaid ? due.toISOString() : null,
    };
  });
  const { data: insts } = await db.from('installments').insert(instRows).select();

  for (const i of insts.filter((x) => x.status === 'paid')) {
    await ap.from('payments').insert({
      plan_id: plan.id, installment_id: i.id, client_id: nana.id, amount: i.amount,
      method: ['in-app', 'momo', 'bank'][i.seq % 3], recorded_by: i.seq % 3 === 0 ? admin.id : null,
      status: 'approved', created_at: i.paid_at,
    });
  }

  // pending manual payment awaiting approval (shows in approvals queue)
  await ap.from('payments').insert({
    plan_id: plan.id, installment_id: insts[6].id, client_id: nana.id, amount: insts[6].amount,
    method: 'momo', recorded_by: admin.id, status: 'pending_approval',
  });

  // ── Invoices ──────────────────────────────────────────────────────
  await ap.from('invoices').insert([
    { number: 'INV-2026-0001', client_id: nana.id, deal_id: nanaDeal.id, amount: 47222.22, due_date: dAgo(10), status: 'paid',    items: [{ desc: 'Installment 6 of 18', amount: 47222.22 }], created_at: daysAgo(40) },
    { number: 'INV-2026-0002', client_id: yaw.id,  amount: 4500,  due_date: dAgo(5),  status: 'overdue', items: [{ desc: 'Osu Apt 2B — June rent', amount: 4500 }], created_at: daysAgo(35) },
    { number: 'INV-2026-0003', client_id: akosua.id, amount: 12000, due_date: dAhead(14), status: 'pending', items: [{ desc: 'Documentation + legal fees', amount: 12000 }], created_at: daysAgo(2) },
  ]);

  // ── Expenses: one pending (approval queue), one approved, one rejected ─
  await ap.from('expenses').insert([
    { submitted_by: kojo.id, amount: 350, category: 'Fuel',        note: 'Client viewings — East Legon x3', status: 'pending', created_at: daysAgo(1) },
    { submitted_by: efua.id, amount: 1200, category: 'Marketing',  note: 'TikTok boosted posts', status: 'approved', decided_by: owner.id, created_at: daysAgo(8) },
    { submitted_by: kojo.id, amount: 800, category: 'Entertainment', note: 'Client lunch', status: 'rejected', reject_reason: 'Needs prior approval for amounts over GHS 500', decided_by: admin.id, created_at: daysAgo(15) },
  ]);

  // ── Conversations + messages ──────────────────────────────────────
  const { data: convs } = await ap.from('conversations').insert([
    { lead_id: kwabena.id, channel: 'whatsapp', contact_name: 'Kwabena Osei', contact_addr: '+233205555555', assigned_to: kojo.id, ai_mode: 'auto',    unread: true,  last_message_at: daysAgo(0.05) },
    { lead_id: ama.id,     channel: 'instagram', contact_name: 'Ama Serwaa',  contact_addr: '@ama.serwaa',   assigned_to: efua.id, ai_mode: 'suggest', unread: false, last_message_at: daysAgo(1) },
    { lead_id: esi.id,     channel: 'whatsapp', contact_name: 'Esi Nyarko',   contact_addr: '+233208888888', assigned_to: efua.id, ai_mode: 'suggest', unread: true,  last_message_at: daysAgo(0.2) },
    { client_id: nana.id,  channel: 'webchat',  contact_name: 'Nana Adjei',   contact_addr: '+233201111111', assigned_to: kojo.id, ai_mode: 'auto',    unread: false, last_message_at: daysAgo(2) },
  ]).select();
  const [convKwabena, convAma, convEsi, convNana] = convs;

  await db.from('messages').insert([
    // Kwabena — AI auto-answered at 2am (labelled)
    { conversation_id: convKwabena.id, direction: 'in',  body: 'Hi, I saw the 2-bed at Airport Residential. Is it still available and what payment plans do you offer?', sender_type: 'contact', created_at: daysAgo(0.4) },
    { conversation_id: convKwabena.id, direction: 'out', body: 'Hello! Yes, the 2-bed at Airport Residential is available at GHS 650,000. We offer flexible installment plans from 12 to 24 months with a 20% deposit. Would you like to book a viewing this week?', sender_type: 'ai', kb_source: 'Payment plan policy', created_at: daysAgo(0.39) },
    { conversation_id: convKwabena.id, direction: 'in',  body: 'Yes please, Saturday morning works for me.', sender_type: 'contact', created_at: daysAgo(0.05) },
    // Ama — sensitive (negotiation) → AI drafted, held back
    { conversation_id: convAma.id, direction: 'in',  body: 'The townhouse is nice but the price is too high. Can you do 750k? Otherwise I look elsewhere.', sender_type: 'contact', created_at: daysAgo(1.1) },
    { conversation_id: convAma.id, direction: 'out', body: 'Hi Ama, thank you for your honesty! The list price is GHS 850,000, but let me speak with management about what’s possible on Unit 12 and come back to you today. Could you share your ideal move-in timeline?', sender_type: 'ai', is_draft: true, created_at: daysAgo(1.05) },
    // Esi — closing stage
    { conversation_id: convEsi.id, direction: 'in',  body: 'My lawyer has reviewed the sale agreement. When can we sign?', sender_type: 'contact', created_at: daysAgo(0.2) },
    { conversation_id: convEsi.id, direction: 'out', body: 'Wonderful news, Esi! I’ll coordinate with our office and propose Thursday 10am at our East Legon office for the signing. Shall I confirm?', sender_type: 'ai', is_draft: true, created_at: daysAgo(0.19) },
    // Nana — portal chat
    { conversation_id: convNana.id, direction: 'in',  body: 'When is my next installment due? And how is construction going on Unit 7?', sender_type: 'contact', created_at: daysAgo(2.1) },
    { conversation_id: convNana.id, direction: 'out', body: 'Hi Nana! Your next installment of GHS 47,222 is due soon — you can pay right in this portal. Unit 7 is now 65% complete and on track for handover. I’ll share progress photos this week!', sender_type: 'ai', kb_source: 'Payment plan policy', created_at: daysAgo(2.05) },
  ]);

  // ── Knowledge base ────────────────────────────────────────────────
  await ap.from('documents').insert([
    { title: 'Payment plan policy', category: 'policy', is_public: true, uploaded_by: admin.id, content_text: 'Alexis Pearl payment plans: minimum 20% deposit, balance spread over 12, 18 or 24 monthly installments at 0% interest. Late payments attract a 2% monthly surcharge after a 7-day grace period. Early settlement earns a 3% discount on the outstanding balance. Payments accepted: bank transfer, mobile money (MTN MoMo, Telecel Cash), card via the client portal, or cash at the office (receipt issued).' },
    { title: 'Viewing & reservation SOP', category: 'sop', is_public: true, uploaded_by: admin.id, content_text: 'Viewings run Tuesday to Saturday, 9am to 4pm, booked at least 24 hours ahead. A unit is reserved with a refundable GHS 5,000 reservation fee valid for 14 days, deductible from the deposit. Reservation lapses automatically if the sale agreement is not signed within 14 days. Refunds are processed within 5 working days of a written request.' },
    { title: 'East Legon Hills brochure', category: 'brochure', property_id: eastLegon.id, uploaded_by: admin.id, content_text: 'East Legon Hills: gated community of 24 townhouses. 3-bed units from GHS 850,000. Each unit: 210sqm, private garden, 2-car parking, smart locks. Community: 24/7 security, backup power, borehole water, communal pool and gym. Handover from Q4. Titles are registered land — Land Commission searchable.' },
    { title: 'Company FAQ', category: 'faq', uploaded_by: admin.id, content_text: 'Q: Are your properties titled? A: Yes, every Alexis Pearl property has a registered land title, verifiable at the Lands Commission. Q: Do you accept diaspora buyers? A: Yes — remote purchase supported with video viewings, and payments via bank transfer in GHS or USD equivalent. Q: What is the office location? A: East Legon, Accra, open Mon-Sat 8:30am-5pm. Q: Do you build custom homes? A: Yes, our development arm builds to spec on client-owned or company land.' },
    { title: 'Nana Adjei — Sale Agreement (Unit 7)', category: 'contract', client_id: nana.id, uploaded_by: admin.id, content_text: 'Sale agreement between Alexis Pearl Ltd and Nana Adjei for Unit 7, East Legon Hills. Price GHS 850,000 payable over 18 monthly installments beginning 6 months ago. Handover upon 100% completion and full payment.' },
  ]);

  // ── PM: lease + ticket on the managed Osu property ────────────────
  const { data: lease } = await ap.from('leases').insert({
    property_id: osu.id, unit_id: apt2b.id, client_id: abena.id,
    rent_amount: 4500, start_date: dAgo(200), end_date: dAhead(45), status: 'active',
  }).select().single();
  await ap.from('payments').insert({
    lease_id: lease.id, client_id: abena.id, amount: 4500, method: 'momo',
    recorded_by: admin.id, status: 'approved', created_at: daysAgo(20),
  });
  await ap.from('tickets').insert([
    { property_id: osu.id, unit_id: apt2b.id, client_id: abena.id, title: 'AC not cooling in master bedroom', description: 'Tenant reports the split unit blows warm air since Monday.', status: 'in_progress', owner_id: admin.id, created_at: daysAgo(3) },
    { property_id: osu.id, unit_id: apt2b.id, client_id: abena.id, title: 'Kitchen tap leaking', status: 'resolved', owner_id: admin.id, created_at: daysAgo(30) },
  ]);

  // ── A few outbox entries so the seam is visible ───────────────────
  await ap.from('outbox').insert([
    { channel: 'whatsapp', to_addr: '+233201111111', body: 'Reminder: installment of GHS 47,222.22 due soon.', ref: 'reminder', status: 'simulated', created_at: daysAgo(3) },
    { channel: 'email', to_addr: 'owner@alexispearl.com', body: 'Weekly digest…', ref: 'report', status: 'simulated', created_at: daysAgo(7) },
  ]);

  await ap.from('audit_log').insert([
    { user_id: owner.id, user_name: 'Alexis Owusu', action: 'approved', entity: 'deal', entity_id: nanaDeal.id, detail: { title: nanaDeal.title }, created_at: daysAgo(55) },
    { user_id: admin.id, user_name: 'Adjoa Baah', action: 'created', entity: 'payment_plan', entity_id: plan.id, detail: { total: 850000, installment_count: 18 }, created_at: daysAgo(54) },
  ]);

  // ── A second, independent agency — proves company isolation in the real app ──
  const { data: SH } = await db.from('companies').upsert({
    slug: 'sunrise-homes', name: 'Sunrise Homes', tagline: 'Rentals in Tema and Spintex',
    contact_phone: '+233302000000', contact_email: 'hello@sunrisehomes.test', brand_color: '#0F766E', services: ['rent'],
  }, { onConflict: 'slug' }).select().single();
  const sh = tenantDb(SH.id, db);
  await sh.from('users').insert([
    { name: 'Sena Mensah', email: 'owner@sunrisehomes.test', role: 'owner', password_hash: hash },
    { name: 'Yaw Darko',   email: 'yaw@sunrisehomes.test',   role: 'agent', password_hash: hash },
  ]);
  await sh.from('properties').insert([
    { title: '2-bed apartment · Spintex', location: 'Spintex Road, Accra', neighbourhood: 'Spintex', city: 'Accra', ptype: 'rent', property_type: 'apartment', price: 3800, rent_period: 'month', advance_months: 12, bedrooms: 2, bathrooms: 2, furnishing: 'unfurnished', amenities: ['security', 'water_storage', 'parking'], listing_status: 'published', published_at: daysAgo(5), description: 'Quiet 2-bed apartment off Spintex Road with dedicated parking.' },
    { title: 'Chamber & hall · Tema Community 18', location: 'Tema C18', neighbourhood: 'Community 18', city: 'Tema', ptype: 'rent', property_type: 'chamber_and_hall', price: 1500, rent_period: 'month', advance_months: 24, bedrooms: 1, bathrooms: 1, amenities: ['prepaid_meter'], listing_status: 'published', published_at: daysAgo(2), description: 'Self-contained chamber and hall close to the Community 18 market.' },
  ]);

  console.log('✔ Seed complete.');
  console.log('Logins (password: demo1234):');
  console.log('  owner@alexispearl.com  — Owner (full dashboard)');
  console.log('  admin@alexispearl.com  — Admin');
  console.log('  kojo@alexispearl.com   — Agent');
  console.log('  efua@alexispearl.com   — Agent');
  console.log('  client@alexispearl.com — Client portal (Nana Adjei)');
  console.log('  owner@sunrisehomes.test — Owner of a second agency (isolation check)');
  console.log('Public sites: /s/alexis-pearl and /s/sunrise-homes');
}

// run when executed directly (npm run seed); tests import run() instead
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((e) => { console.error(e); process.exit(1); });
}
