'use client';
import { useEffect, useRef, useState } from 'react';
import { PUBLIC_API, PublicProperty, fmtPrice, placeLine, propertyPath } from '@/lib/publicApi';
import { I } from '@/components/Icons';

type Msg = { role: 'user' | 'assistant'; content: string; properties?: PublicProperty[]; actions?: { type: string; property_id?: string }[] };

const SUGGESTIONS = [
  'Find me a two-bedroom apartment to rent',
  'What is available within GHS 5,000 a month?',
  'Which properties have backup power?',
  'What do I need before applying?',
];

/**
 * Floating property assistant. It only reads published listings of this agency
 * (server enforced) and hands off to the normal forms for enquiries and viewings.
 */
export default function Assistant({ slug, companyName, propertyId }: { slug: string; companyName: string; propertyId?: string }) {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { body.current?.scrollTo({ top: body.current.scrollHeight }); }, [msgs, busy]);
  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [open]);

  const send = async (q: string) => {
    const question = q.trim();
    if (!question || busy) return;
    const history: Msg[] = [...msgs, { role: 'user', content: question }];
    setMsgs(history); setText(''); setBusy(true);
    // context for "compare these": the property being viewed + the last results shown
    const lastResults = [...msgs].reverse().find((m) => m.properties?.length)?.properties?.map((p) => p.id) || [];
    const ids = Array.from(new Set([...(propertyId ? [propertyId] : []), ...lastResults])).slice(0, 4);
    try {
      const r = await fetch(`${PUBLIC_API}/api/public/${slug}/assistant`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history.map(({ role, content }) => ({ role, content })), property_ids: ids }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'The assistant is unavailable right now.');
      setMsgs([...history, { role: 'assistant', content: j.reply, properties: j.properties, actions: j.actions }]);
    } catch (e: any) {
      setMsgs([...history, { role: 'assistant', content: `${e.message === 'Failed to fetch' ? 'You seem to be offline.' : e.message} You can always contact ${companyName} directly.`, actions: [{ type: 'handoff' }] }]);
    } finally { setBusy(false); }
  };

  const action = (a: { type: string; property_id?: string }, props?: PublicProperty[]) => {
    if (a.type === 'book_viewing' && a.property_id) {
      const p = props?.find((x) => x.id === a.property_id);
      return <a key="v" className="s-btn s-btn-primary s-btn-sm" href={`${p ? propertyPath(slug, p) : `/s/${slug}/property/${a.property_id}`}#book`}>Request a viewing</a>;
    }
    if (a.type === 'enquire' || a.type === 'handoff') {
      return <a key={a.type} className="s-btn s-btn-ghost s-btn-sm" href={propertyId ? '#enquire' : `/s/${slug}#contact`} onClick={() => setOpen(false)}>{a.type === 'handoff' ? 'Talk to an agent' : 'Send an enquiry'}</a>;
    }
    return null;
  };

  return (
    <>
      {!open && (
        <button className="s-ai-fab" onClick={() => setOpen(true)} aria-haspopup="dialog">
          <I name="sparkle" size={18} /> Ask about homes
        </button>
      )}
      {open && (
        <div className="s-ai" role="dialog" aria-modal="false" aria-label={`${companyName} property assistant`}>
          <div className="s-ai-head">
            <span className="s-tile-icon"><I name="sparkle" size={18} /></span>
            <div><b>Property assistant</b><small>Answers from {companyName}'s published listings</small></div>
            <button className="s-btn s-btn-quiet" onClick={() => setOpen(false)} aria-label="Close assistant"><I name="x" size={20} /></button>
          </div>
          <div className="s-ai-body" ref={body} aria-live="polite">
            {!msgs.length && (
              <>
                <div className="s-ai-bubble bot">Hi! Tell me what you're looking for — area, budget, bedrooms, rent or buy — and I'll find matching listings from {companyName}.</div>
                <div className="s-ai-suggest">{SUGGESTIONS.map((s) => <button key={s} onClick={() => send(s)}>{s}</button>)}</div>
              </>
            )}
            {msgs.map((m, i) => (
              <div key={i} style={{ display: 'grid', gap: 8 }}>
                <div className={`s-ai-bubble ${m.role === 'user' ? 'user' : 'bot'}`}>{m.content}</div>
                {!!m.properties?.length && (
                  <div className="s-ai-cards">
                    {m.properties.map((p) => (
                      <a key={p.id} className="s-ai-card" href={propertyPath(slug, p)}>
                        <span className="s-ai-thumb">{p.images[0] ? <img src={p.images[0]} alt="" loading="lazy" /> : null}</span>
                        <span><b>{p.title}</b><small>{fmtPrice(p)} · {placeLine(p)} · {p.availability.label}</small></span>
                      </a>
                    ))}
                  </div>
                )}
                {!!m.actions?.length && <div className="s-ai-actions">{m.actions.map((a) => action(a, m.properties))}</div>}
              </div>
            ))}
            {busy && <div className="s-ai-bubble bot" aria-label="Assistant is typing"><span className="s-typing"><i /><i /><i /></span></div>}
          </div>
          <div className="s-ai-foot">
            <form onSubmit={(e) => { e.preventDefault(); send(text); }}>
              <label className="s-sr" htmlFor="s-ai-input">Your question</label>
              <input id="s-ai-input" ref={input} className="s-input" value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} placeholder="e.g. 3-bed house in Tema under 1.5m" autoComplete="off" />
              <button className="s-btn s-btn-primary" disabled={busy || !text.trim()} aria-label="Send"><I name="send" size={18} /></button>
            </form>
            <small>AI can be wrong. Prices and availability are confirmed by the agency.</small>
          </div>
        </div>
      )}
    </>
  );
}
