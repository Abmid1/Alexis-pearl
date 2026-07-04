'use client';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { ScreenHead, Modal, timeAgo } from '@/components/Shell';

const CH_ICON: Record<string, string> = { whatsapp: '🟢', sms: '✉️', email: '📧', webchat: '🌐', instagram: '📸', tiktok: '🎵', x: '𝕏', call: '📞' };

export default function Inbox() {
  const [convs, setConvs] = useState<any[]>([]);
  const [active, setActive] = useState<any>(null);
  const [text, setText] = useState('');
  const [editDraft, setEditDraft] = useState<{ id: string; text: string } | null>(null);
  const [showSim, setShowSim] = useState(false);
  const [sim, setSim] = useState({ channel: 'whatsapp', from_name: '', from_addr: '', body: '' });
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadList = () => api.inbox.list().then(setConvs).catch(() => {});
  const openConv = (id: string) => api.inbox.get(id).then(setActive).catch(() => {});
  useEffect(() => { loadList(); }, []);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [active?.messages?.length]);

  const refresh = () => { if (active) openConv(active.id); loadList(); };

  const send = async () => {
    if (!text.trim() || !active) return;
    const t = text; setText('');
    await api.inbox.send(active.id, t).catch(() => {});
    refresh();
  };

  const toggleMode = async () => {
    if (!active) return;
    const next = active.ai_mode === 'auto' ? 'suggest' : 'auto';
    await api.inbox.setMode(active.id, next).catch(() => {});
    refresh();
  };

  const simulate = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true);
    try {
      const r = await api.inbox.simulate(sim);
      setShowSim(false);
      setSim({ channel: 'whatsapp', from_name: '', from_addr: '', body: '' });
      loadList();
      openConv(r.conversation.id);
    } finally { setBusy(false); }
  };

  const drafts = active?.messages?.filter((m: any) => m.is_draft) || [];
  const visible = active?.messages?.filter((m: any) => !m.is_draft) || [];

  return (
    <div>
      <ScreenHead id="1d" title="Unified Inbox" phase={1}>
        <button className="btn" onClick={() => setShowSim(true)}>⚡ Simulate inbound</button>
      </ScreenHead>

      <div style={{ display: 'flex', gap: 12, height: 'calc(100vh - 170px)', minHeight: 420 }}>
        {/* List */}
        <div style={{ width: 300, flexShrink: 0, overflowY: 'auto', display: active && typeof window !== 'undefined' && window.innerWidth < 861 ? 'none' : 'flex', flexDirection: 'column', gap: 8 }}>
          {convs.map((c) => (
            <button key={c.id} className="card" style={{ textAlign: 'left', cursor: 'pointer', padding: 12, borderColor: active?.id === c.id ? 'var(--green)' : undefined, width: '100%' }}
              onClick={() => openConv(c.id)}>
              <div className="spread" style={{ marginBottom: 4 }}>
                <div className="row" style={{ minWidth: 0 }}>
                  <span>{CH_ICON[c.channel]}</span>
                  <strong style={{ fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.contact_name}</strong>
                  {c.unread && <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--red)', flexShrink: 0 }} />}
                </div>
                <span className="muted" style={{ fontSize: 10, flexShrink: 0 }}>{timeAgo(c.last_message_at)}</span>
              </div>
              <div className="muted" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginBottom: 6 }}>
                {c.lastMessage?.body || '—'}
              </div>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                <span className={`tag ${c.ai_mode === 'auto' ? 't-green' : 't-amber'}`}>{c.ai_mode === 'auto' ? '🟢 Auto' : '🟡 Suggest'}</span>
                {!c.assigned_to && <span className="tag t-red">Unassigned</span>}
                {c.pendingDrafts > 0 && <span className="tag t-purple">{c.pendingDrafts} draft</span>}
              </div>
            </button>
          ))}
          {convs.length === 0 && <div className="card muted" style={{ textAlign: 'center' }}>No conversations yet — try “Simulate inbound”.</div>}
        </div>

        {/* Thread */}
        {active ? (
          <div className="card" style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 0, minWidth: 0 }}>
            <div className="spread" style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap', gap: 8 }}>
              <div className="row" style={{ minWidth: 0 }}>
                <button className="btn btn-sm mobile-only" onClick={() => setActive(null)}>←</button>
                <span>{CH_ICON[active.channel]}</span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13.5 }}>{active.contact_name}</div>
                  <div className="muted" style={{ fontSize: 11 }}>
                    {active.channel} · {active.agent?.name ? `assigned to ${active.agent.name}` : 'unassigned'}
                    {active.lead && ` · lead: ${active.lead.stage}`}
                  </div>
                </div>
              </div>
              <div className="row">
                {!active.assigned_to && <button className="btn btn-sm" onClick={async () => { await api.inbox.assign(active.id); refresh(); }}>Assign to me</button>}
                <button className={`btn btn-sm ${active.ai_mode === 'auto' ? '' : 'btn-green'}`} onClick={toggleMode}>
                  {active.ai_mode === 'auto' ? '✋ Take over' : '🤖 Return to Auto'}
                </button>
              </div>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {visible.map((m: any) => (
                <div key={m.id} style={{
                  alignSelf: m.direction === 'in' ? 'flex-start' : 'flex-end',
                  maxWidth: '78%',
                  background: m.direction === 'in' ? 'var(--bg-elevated)' : (m.sender_type === 'ai' ? 'rgba(52,211,153,0.12)' : 'var(--green)'),
                  color: m.direction === 'out' && m.sender_type !== 'ai' ? '#fff' : 'var(--text-primary)',
                  borderRadius: 12, padding: '9px 12px', fontSize: 13.5, lineHeight: 1.55,
                }}>
                  {m.body}
                  <div style={{ fontSize: 10, opacity: 0.7, marginTop: 4, display: 'flex', gap: 6 }}>
                    {m.sender_type === 'ai' && <span style={{ fontWeight: 700 }}>🤖 AI</span>}
                    {m.kb_source && <span>📎 {m.kb_source}</span>}
                    <span>{timeAgo(m.created_at)}</span>
                  </div>
                </div>
              ))}

              {/* AI drafts awaiting review */}
              {drafts.map((d: any) => (
                <div key={d.id} style={{ alignSelf: 'flex-end', maxWidth: '85%', border: '1px dashed var(--amber)', borderRadius: 12, padding: '10px 12px', background: 'rgba(251,191,36,0.05)' }}>
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--amber)', marginBottom: 5 }}>🤖 AI DRAFT — held back for your review{d.kb_source ? ` · 📎 ${d.kb_source}` : ''}</div>
                  <div style={{ fontSize: 13.5, lineHeight: 1.55, marginBottom: 8 }}>{d.body}</div>
                  <div className="row" style={{ gap: 6 }}>
                    <button className="btn btn-sm btn-green" onClick={async () => { await api.inbox.approveDraft(active.id, d.id); refresh(); }}>Send as-is</button>
                    <button className="btn btn-sm" onClick={() => setEditDraft({ id: d.id, text: d.body })}>Edit</button>
                    <button className="btn btn-sm btn-red" onClick={async () => { await api.inbox.discardDraft(active.id, d.id); refresh(); }}>Discard</button>
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>

            <div className="row" style={{ padding: 12, borderTop: '1px solid var(--border)' }}>
              <input className="form-input" style={{ flex: 1 }} placeholder={`Reply via ${active.channel}…`}
                value={text} onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && send()} />
              <button className="btn btn-green" onClick={send}>Send</button>
            </div>
          </div>
        ) : (
          <div className="card muted" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            Select a conversation
          </div>
        )}
      </div>

      {editDraft && (
        <Modal title="Edit AI draft before sending" onClose={() => setEditDraft(null)}>
          <textarea className="form-input" rows={5} value={editDraft.text} onChange={(e) => setEditDraft((p) => p && { ...p, text: e.target.value })} />
          <button className="btn btn-green btn-block" style={{ marginTop: 12 }} onClick={async () => {
            await api.inbox.approveDraft(active.id, editDraft.id, editDraft.text);
            setEditDraft(null); refresh();
          }}>Send edited reply</button>
        </Modal>
      )}

      {showSim && (
        <Modal title="Simulate an inbound message" onClose={() => setShowSim(false)}>
          <div className="muted" style={{ marginBottom: 12 }}>
            Behaves exactly like a real webhook: creates/updates the lead (tagged with source), stores the message, and lets the AI act per the conversation's mode.
          </div>
          <form onSubmit={simulate}>
            <div className="form-group">
              <label className="form-label">Channel</label>
              <select className="form-select" value={sim.channel} onChange={(e) => setSim((p) => ({ ...p, channel: e.target.value }))}>
                {['whatsapp', 'sms', 'email', 'webchat', 'instagram', 'tiktok', 'x'].map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">From (name)</label>
              <input className="form-input" value={sim.from_name} onChange={(e) => setSim((p) => ({ ...p, from_name: e.target.value }))} placeholder="Kwame Test" />
            </div>
            <div className="form-group">
              <label className="form-label">From (number / handle) *</label>
              <input className="form-input" required value={sim.from_addr} onChange={(e) => setSim((p) => ({ ...p, from_addr: e.target.value }))} placeholder="+233240000000" />
            </div>
            <div className="form-group">
              <label className="form-label">Message *</label>
              <textarea className="form-input" required rows={3} value={sim.body} onChange={(e) => setSim((p) => ({ ...p, body: e.target.value }))} placeholder="What payment plans do you offer for East Legon Hills?" />
            </div>
            <button className="btn btn-green btn-block" disabled={busy}>{busy ? 'Delivering…' : 'Deliver message'}</button>
          </form>
        </Modal>
      )}
    </div>
  );
}
