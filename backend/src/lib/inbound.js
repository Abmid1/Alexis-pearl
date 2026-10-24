import { db } from '../db.js';
import { draftReply } from './ai.js';
import { sendMessage } from './integrations.js';
import { nextAgent } from './assign.js';
import { audit } from './audit.js';

const CHANNEL_SOURCE = { whatsapp: 'WhatsApp', sms: 'SMS', email: 'Email', webchat: 'Website', instagram: 'Instagram', tiktok: 'TikTok', x: 'X' };

/**
 * Every inbound message from any channel lands here (webhooks + demo simulator).
 * Creates/updates the lead + conversation, stores the message, then lets the AI
 * act according to the conversation's mode:
 *   auto    → AI sends itself when confident, labelled + logged; drafts otherwise
 *   suggest → AI only drafts; agent reviews and sends
 * companyId is always resolved server-side by the caller.
 */
export async function handleInbound({ companyId, channel, fromAddr, fromName, body }) {
  if (!companyId) throw new Error('handleInbound requires companyId');

  // 1. find or create conversation (per company — the same phone can talk to two agencies)
  let { data: conv } = await db.from('conversations').select('*')
    .eq('company_id', companyId).eq('channel', channel).eq('contact_addr', fromAddr).maybeSingle();

  if (!conv) {
    // auto-captured lead (Path A) — tagged with source, one owner, zero typing
    const agent = await nextAgent(companyId);
    const { data: lead } = await db.from('leads').insert({
      company_id: companyId,
      name: fromName || fromAddr,
      phone: channel === 'email' ? null : fromAddr,
      email: channel === 'email' ? fromAddr : null,
      source: CHANNEL_SOURCE[channel] || channel,
      owner_id: agent?.id || null,
      next_follow_up: new Date(Date.now() + 24 * 3600000).toISOString(),
    }).select().single();

    const ins = await db.from('conversations').insert({
      company_id: companyId,
      lead_id: lead.id, channel, contact_name: fromName || fromAddr, contact_addr: fromAddr,
      assigned_to: agent?.id || null, ai_mode: 'auto', unread: true,
    }).select().single();
    conv = ins.data;
    await audit(null, 'auto_captured', 'lead', lead.id, { source: CHANNEL_SOURCE[channel], assigned_to: agent?.name }, companyId);
  }

  // 2. store inbound message
  const { data: msg } = await db.from('messages').insert({
    conversation_id: conv.id, direction: 'in', body, sender_type: 'contact',
  }).select().single();
  await db.from('conversations').update({ unread: true, last_message_at: new Date().toISOString() }).eq('id', conv.id);

  // 3. AI acts
  const { data: history } = await db.from('messages')
    .select('direction,body').eq('conversation_id', conv.id).eq('is_draft', false)
    .order('created_at', { ascending: false }).limit(8);
  const ai = await draftReply({
    companyId, contactName: conv.contact_name, channel,
    history: (history || []).reverse(), incoming: body,
  });

  let aiAction = 'drafted';
  if (conv.ai_mode === 'auto' && ai.confident) {
    // Auto mode + confident → send it, labelled and logged
    await db.from('messages').insert({
      conversation_id: conv.id, direction: 'out', body: ai.text,
      sender_type: 'ai', is_draft: false, kb_source: ai.kbSource,
    });
    await sendMessage(channel, fromAddr, ai.text, 'ai-auto-reply', { companyId });
    await db.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conv.id);
    await audit(null, 'ai_sent', 'message', conv.id, { channel, kb_source: ai.kbSource }, companyId);
    aiAction = 'sent';
  } else {
    // Suggest mode, or not confident → hold back, draft only
    await db.from('messages').insert({
      conversation_id: conv.id, direction: 'out', body: ai.text,
      sender_type: 'ai', is_draft: true, kb_source: ai.kbSource,
    });
  }

  return { conversation: conv, message: msg, aiAction };
}
