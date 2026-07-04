import { db } from '../db.js';

/**
 * AI brain — Gemini when GEMINI_API_KEY is set, deterministic fallback
 * otherwise so every AI feature stays functional in demo mode.
 * Powers: inbox replies (1d), daily brief (1a), listing copy (1e), KB answers (1i).
 */

const MODEL = 'gemini-2.0-flash';

async function gemini(prompt) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      }
    );
    const j = await r.json();
    return j?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
  } catch {
    return null;
  }
}

// Topics the AI must NOT auto-answer — always hold back and draft (Suggest).
const SENSITIVE = /negotiat|discount|lower|reduce|complain|angry|upset|refund|cancel|lawyer|legal|court|dispute|problem|wrong|scam|fraud|terrible/i;

export function isSensitive(text) {
  return SENSITIVE.test(text);
}

/** Search KB documents for the best match to a question (simple relevance scoring). */
export async function searchKB(question) {
  const { data: docs } = await db.from('documents').select('id,title,category,content_text').not('content_text', 'is', null);
  if (!docs?.length) return [];
  const words = question.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
  const scored = docs
    .map((d) => {
      const body = `${d.title} ${d.content_text}`.toLowerCase();
      const score = words.reduce((s, w) => s + (body.includes(w) ? 1 : 0), 0);
      return { ...d, score };
    })
    .filter((d) => d.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, 3);
}

/** Inbox reply (1d). Returns { text, confident, kbSource }. */
export async function draftReply({ contactName, channel, history, incoming }) {
  const kbDocs = await searchKB(incoming);
  const kbSource = kbDocs[0]?.title || null;
  const sensitive = isSensitive(incoming);
  const confident = !!kbDocs.length && !sensitive;

  const kbSection = kbDocs.length
    ? `COMPANY KNOWLEDGE (answer from this, cite nothing else):\n${kbDocs.map((d) => `[${d.title}]\n${d.content_text.slice(0, 1500)}`).join('\n\n')}`
    : 'No knowledge-base match — answer generally and offer to connect them with an agent.';

  const prompt = `You are the assistant for Alexis Pearl, a real estate company in Accra, Ghana. Currency is GHS.
Reply to this ${channel} message from ${contactName || 'a client'}. Be warm, brief (under 80 words), and concrete.

${kbSection}

RECENT CONVERSATION:
${history.map((m) => `${m.direction === 'in' ? 'Client' : 'Us'}: ${m.body}`).join('\n')}

CLIENT'S NEW MESSAGE: ${incoming}

Reply only with the message text.`;

  let text = await gemini(prompt);
  if (!text) {
    // Fallback drafts keep the workflow alive without an API key
    text = kbDocs.length
      ? `Hi${contactName ? ' ' + contactName : ''}! ${kbDocs[0].content_text.slice(0, 220)}${kbDocs[0].content_text.length > 220 ? '…' : ''} Would you like me to connect you with your agent for more detail?`
      : `Hi${contactName ? ' ' + contactName : ''}, thanks for reaching out to Alexis Pearl! One of our agents will get back to you shortly. Is there anything specific about a property, payment plan, or viewing I can note for them?`;
  }
  return { text, confident, kbSource };
}

/** Command-center daily brief (1a). */
export async function dailyBrief(stats) {
  const prompt = `You are the operations analyst for Alexis Pearl real estate, Accra. Write a 3-4 sentence morning brief in plain English for the owner. No headings, no bullets. Data:
- Cold leads (no contact 7+ days): ${stats.coldLeads.map((l) => l.name).join(', ') || 'none'}
- Overdue follow-ups: ${stats.overdueCount}
- Payments due in next 7 days: ${stats.upcoming.map((u) => `${u.client} GHS ${u.amount} on ${u.due}`).join('; ') || 'none'}
- Best lead source this month: ${stats.topSource || 'n/a'} (${stats.topSourceCount || 0} leads)
- Pending approvals: ${stats.pendingApprovals}`;

  const out = await gemini(prompt);
  if (out) return out;
  const parts = [];
  parts.push(
    stats.overdueCount > 0
      ? `You have ${stats.overdueCount} overdue follow-up${stats.overdueCount > 1 ? 's' : ''} that need attention today.`
      : 'No overdue follow-ups — the pipeline is being worked on time.'
  );
  if (stats.coldLeads.length) parts.push(`${stats.coldLeads.length} lead${stats.coldLeads.length > 1 ? 's have' : ' has'} gone cold (${stats.coldLeads.slice(0, 3).map((l) => l.name).join(', ')}) — worth a re-touch.`);
  if (stats.upcoming.length) parts.push(`${stats.upcoming.length} installment payment${stats.upcoming.length > 1 ? 's are' : ' is'} due within 7 days totalling GHS ${stats.upcoming.reduce((s, u) => s + Number(u.amount), 0).toLocaleString()}.`);
  if (stats.topSource) parts.push(`${stats.topSource} is your best-performing channel this month with ${stats.topSourceCount} leads.`);
  if (stats.pendingApprovals) parts.push(`${stats.pendingApprovals} item${stats.pendingApprovals > 1 ? 's' : ''} await your approval.`);
  return parts.join(' ');
}

/** Listing copy (1e) — drafted by AI, approved by Owner/Admin before publish. */
export async function listingCopy(property) {
  const prompt = `Write a compelling 60-90 word property listing for social media. Property: ${property.title}, ${property.location}, GHS ${Number(property.price).toLocaleString()}, type: ${property.ptype}. ${property.description || ''} End with a call to action to message us. No hashtags, no emojis in the first sentence.`;
  const out = await gemini(prompt);
  if (out) return out;
  return `${property.title} — ${property.location}. Now ${property.ptype === 'rent' ? 'renting' : 'selling'} at GHS ${Number(property.price).toLocaleString()}. ${property.description ? property.description.slice(0, 120) : 'Prime location, flexible payment plans available.'} 📍 Message us today to book a viewing — plots and units are moving fast.`;
}

/** Knowledge-base ask-anything (1i). Returns { answer, sources }. */
export async function kbAnswer(question) {
  const docs = await searchKB(question);
  if (!docs.length) {
    return { answer: 'No matching document found in the knowledge base. Try different wording, or upload the relevant document first.', sources: [] };
  }
  const prompt = `Answer the staff question using ONLY these company documents. Be direct and under 120 words. If the documents don't fully answer it, say what's missing.

${docs.map((d) => `[${d.title}]\n${d.content_text.slice(0, 2000)}`).join('\n\n')}

QUESTION: ${question}`;
  const out = await gemini(prompt);
  return {
    answer: out || `From "${docs[0].title}": ${docs[0].content_text.slice(0, 400)}${docs[0].content_text.length > 400 ? '…' : ''}`,
    sources: docs.map((d) => ({ id: d.id, title: d.title, category: d.category })),
  };
}
